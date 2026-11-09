"""GRAPHCAUSE 图框。区域坐标使用 A3 横版图纸的参考点，经页面尺寸换算。"""
import json
import re
from datetime import datetime
from io import BytesIO
from pathlib import Path

import fitz
from PIL import Image, ImageChops, ImageStat
from explanations import details
from symbols import check_annotations

ROOT = Path(__file__).resolve().parent
PROFILE = json.loads((ROOT / 'profile.json').read_text())
NAMES = ['企业 Logo', '图纸名称', '图号一致性', '设计责任方', '日期有效性', '版本号',
         '状态与签审', '页码与总页数', '图幅', '尺寸单位', '比例说明', '材料信息']
# 参考图框上的字段区域，包含标题与数值，单位为 PDF 点
REGIONS = [(607,774,640,805),(582,650,861,711),(866,650,988,711),(583,716,861,742),
           (1075,713,1155,743),(1076,650,1155,711),(865,716,988,742),(582,744,860,773),
           (990,744,1073,773),(1075,744,1155,773),(991,716,1074,743),(991,650,1074,711)]
EMPTY = {'','—','-','/','待定','未命名','待填写','待核定'}


def valid_date(value):
    for fmt in PROFILE['date_formats']:
        try:
            datetime.strptime(value, fmt)
            return True
        except ValueError:
            continue
    return False


def inspect_page(page, count, kind):
    width, height = page.rect.width, page.rect.height
    regions = [fitz.Rect(a*width/1190.55,b*height/841.89,c*width/1190.55,d*height/841.89)
               for a,b,c,d in REGIONS]
    contents = [' '.join(page.get_textbox(r).split()) for r in regions]
    labels = ['', '零件名称','图号','设计','日期','版本','审核','共','图幅','单位','比例','材料']
    known = not page.rotation and sum(v.startswith(k) for v,k in zip(contents[1:],labels[1:])) >= 8
    results = []

    def record(index, ok, evidence, extra=(), skip=False):
        primary = regions[index]
        if known and index in (1,2,3,4,5,6,8,9,10,11):
            value = contents[index].removeprefix(labels[index]).strip()
            hits = page.search_for(value, clip=primary) if value else []
            if hits:
                primary = hits[0]
        boxes = [primary, *extra] if known else []
        state = '待复核' if not known or ok is None else ('通过' if ok else '异常')
        if known and skip:
            state = '不适用'
        results.append(dict(rule=NAMES[index], status=state,
                            page=page.number+1, **details(index,state,PROFILE),
                            evidence=evidence if known else '未定位到已配置图框，需人工核对。',
                            boxes=[[r.x0/width,r.y0/height,r.x1/width,r.y1/height] for r in boxes]))
    if not known:
        for i in range(12):
            record(i,None,'')
        return results[:8] + check_annotations(page,known=False)[:2]
    def field(i):
        return contents[i].removeprefix(labels[i]).strip()

    pix = page.get_pixmap(clip=regions[0],matrix=fitz.Matrix(2,2),colorspace=fitz.csGRAY)
    with Image.open(ROOT / PROFILE['logo_reference']) as ref:
        actual = Image.frombytes('L',(pix.width,pix.height),pix.samples).resize(ref.size)
        # 将差异除以参考图标的墨量，避免空白背景主导相似度
        diff = ImageStat.Stat(ImageChops.difference(actual,ref)).sum[0]
        ink = ImageStat.Stat(ImageChops.invert(ref)).sum[0]
    record(0,diff/ink < .35, f"{PROFILE['brand']} 图签标志"+('匹配' if diff/ink < .35 else '缺失或不匹配'))
    record(1,field(1) not in EMPTY,contents[1] or '名称栏空白')
    text = page.get_text()
    head = re.search(r'图号\s+([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)',page.get_textbox(fitz.Rect(0,0,width,height*.28)))
    number = field(2)
    record(2,bool(re.fullmatch(PROFILE['drawing_number'],number)) and (not head or number==head[1]),
           f'图签 {number}'+(f'；页首 {head[1]}' if head else ''),page.search_for(head[0]) if head else [])
    designer = field(3)
    record(3,designer in PROFILE['design_teams'] or (designer not in EMPTY and bool(re.fullmatch(r'[\u3400-\u9fff]{2,8}|[A-Za-z]+(?: [A-Za-z]+)+',designer))),contents[3] or '设计栏空白')
    record(4,valid_date(field(4)),contents[4])
    record(5,bool(re.fullmatch(PROFILE['revision'],field(5))),contents[5])
    states = re.findall(r'\[\s*[√✓xX]\s*\]\s*([^\s\[]+)',text)
    record(6,len(states)==1 and (states[0] not in PROFILE['require_reviewer'] or field(6) not in EMPTY),
           f"状态 {'、'.join(states) or '未选'}；{contents[6]}",page.search_for('状态')[:1])
    pages = re.search(r'共\s*(\d+)\s*页\s*/\s*第\s*(\d+)\s*页',contents[7])
    record(7,bool(pages and (int(pages[1]),int(pages[2]))==(count,page.number+1)),
           f'{contents[7]}；PDF 第 {page.number+1} 页，共 {count} 页')
    sizes = {'A4':(210,297),'A3':(297,420),'A2':(420,594),'A1':(594,841),'A0':(841,1189)}
    mm = sorted(n*25.4/72 for n in (width,height))
    size = sizes.get(field(8))
    record(8,bool(size and all(abs(a-b)<2 for a,b in zip(size,mm))),f'{contents[8]}；实测 {mm[0]:.1f} × {mm[1]:.1f} mm')
    record(9,field(9) in PROFILE['units'],contents[9],skip=kind=='schematic')
    scales = re.findall(r'比例\s*(\d+(?:\.\d+)?\s*[:：]\s*\d+(?:\.\d+)?)',page.get_textbox(fitz.Rect(0,0,width,height*.75)))
    value = field(10)
    record(10,bool(scales) if value=='见视图' else bool(re.fullmatch(r'\d+(?:\.\d+)?[:：]\d+(?:\.\d+)?',value)),
           contents[10]+'；视图比例 '+'、'.join(scales),[r for s in scales for r in page.search_for('比例 '+s)][:8])
    record(11,field(11) not in EMPTY,contents[11],skip=kind in ('assembly','schematic'))
    return results[:8] + check_annotations(page)[:2]


def preview(page):
    matrix = fitz.Matrix(1550/max(page.rect.width,page.rect.height),1550/max(page.rect.width,page.rect.height))
    pix = page.get_pixmap(matrix=matrix)
    return pix.tobytes('png')
