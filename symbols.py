"""从 PDF 文字层识别工程标记并保留原文位置。"""
import re

PATTERNS = [
    ('直径', r'[Φφ⌀Ø]\s*\d+(?:\.\d+)?'),
    ('对称公差', r'±\s*\d+(?:\.\d+)?'),
    ('单向公差', r'\+\s*\d+(?:\.\d+)?\s*/\s*0'),
    ('配合公差带', r'(?<=\d)\s+[A-HJ-Z][a-z]?\d{1,2}\b'),
    ('螺纹', r'M\d+(?:[×x]\d+(?:\.\d+)?)?(?:-\d+[A-Za-z])?'),
    ('表面粗糙度', r'Ra\s*\d+(?:\.\d+)?'),
    ('倒角', r'C\d+(?:\.\d+)?(?:[×x]\d+°)?'),
    ('基准引用', r'\|[A-Z]\|(?:[A-Z]\|)*'),
]


def identify_symbols(page):
    found = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            text = ''.join(span['text'] for span in line['spans'])
            for category, pattern in PATTERNS:
                for match in re.finditer(pattern, text):
                    value = match[0].strip()
                    boxes = page.search_for(value, clip=line['bbox'])
                    if not boxes:
                        continue
                    found.append(dict(category=category,value=value,context=text,page=page.number+1,
                                      boxes=[[b.x0/page.rect.width,b.y0/page.rect.height,
                                              b.x1/page.rect.width,b.y1/page.rect.height] for b in boxes]))
    return found


def check_annotations(page, known=True):
    """同一特征跨主视图/局部视图/技术要求比对，缺证据则待复核。"""
    w,h=page.rect.width,page.rect.height
    def region(coords):
        import fitz
        return fitz.Rect(coords[0]*w/1190.55,coords[1]*h/841.89,
                         coords[2]*w/1190.55,coords[3]*h/841.89)
    specs=[
        ('轴承孔配合标注一致性',
         (900,160,1100,200), r'Φ\s*58\s*(H\d+)',
         (200,50,800,400),r'Φ\s*58\s*(H\d+)',
         '轴承孔局部放大 I 与主视图的 Φ58 孔公差带应一致。',
         '核对轴承配合设计要求，统一主视图、局部放大图及技术要求中的公差带。',
         '局部放大 I 与主视图轴承孔标注'),
        ('配合面粗糙度一致性',
         (820,310,1000,355),r'Ra\s*(\d+(?:\.\d+)?)',
         (40,675,310,690),r'Ra\s*(\d+(?:\.\d+)?)',
         '局部放大 I 的配合面 Ra 数值应与技术要求第 2 条一致。',
         '按关键配合面的表面要求确认 Ra 数值，统一局部标注与技术要求。',
         '局部放大 I 与技术要求第 2 条'),
        ('螺纹规格标注一致性',
         (940,410,1100,445),r'M\d+-\d+[A-Za-z]',
         (200,50,800,400),r'M\d+-\d+[A-Za-z]',
         '局部放大 II 的螺纹规格及公差带应与主视图相同。',
         '核对紧固件及设计要求，统一主视图和局部放大图的螺纹规格。',
         '局部放大 II 与主视图螺纹标注')
    ]
    results=[]
    for name,local,pattern,source,source_pattern,criterion,advice,location in specs:
        lr,sr=region(local),region(source)
        lt=page.get_textbox(lr);st=page.get_textbox(sr)
        lm=re.search(pattern,lt);sm=re.search(source_pattern,st)
        status='待复核'
        if known and lm and sm:
            status='通过' if lm[0].replace(' ','')==sm[0].replace(' ','') else '异常'
        evidence=f"局部标注 {lm[0] if lm else '未识别'}；对照标注 {sm[0] if sm else '未识别'}"
        boxes=[]
        if known:
            for match,rect in [(lm,lr),(sm,sr)]:
                if match:
                    boxes.extend([[b.x0/w,b.y0/h,b.x1/w,b.y1/h] for b in page.search_for(match[0],clip=rect)])
        results.append(dict(rule=name,status=status,evidence=evidence,criterion=criterion,
                            reason=('两处对应特征的标注不一致。' if status=='异常' else
                                    '两处标注一致。' if status=='通过' else '尚未取得两处可靠证据，需要人工核对。'),
                            advice='本项无需修改。' if status=='通过' else advice,
                            location=location,page=page.number+1,boxes=boxes))
    return results
