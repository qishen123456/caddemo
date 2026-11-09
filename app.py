import base64

import fitz
from flask import Flask, jsonify, request, send_from_directory

from inspect_pdf import ROOT, inspect_page, preview
from symbols import identify_symbols

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 12 * 1024 * 1024
SAMPLES = {'reference','revision'}


@app.get('/')
def home():
    return app.send_static_file('index.html')


@app.get('/samples/<sample>.pdf')
def sample_pdf(sample):
    if sample not in SAMPLES:
        return jsonify(error='样本不存在'),404
    return send_from_directory(ROOT/'samples',sample+'.pdf')


@app.errorhandler(413)
def too_large(_):
    return jsonify(error='上传上限为 12 MB'),413


@app.post('/api/inspect')
def inspect():
    kind = request.form.get('kind','part')
    if kind not in {'part','assembly','schematic'}:
        return jsonify(error='请选择图纸类型'),400
    file = request.files.get('file')
    sample = request.form.get('sample')
    if file:
        content = file.read()
        name = file.filename
    elif sample in SAMPLES:
        content = (ROOT/'samples'/(sample+'.pdf')).read_bytes()
        name = '精密异形减速器端盖 · '+('基准图' if sample=='reference' else '缺陷图')
    else:
        return jsonify(error='请选择 PDF 图纸'),400
    try:
        with fitz.open(stream=content) as doc:
            if not doc.is_pdf or doc.needs_pass or not 1 <= len(doc) <= 8:
                return jsonify(error='支持 1 至 8 页的未加密 PDF'),400
            pages = []
            for page in doc:
                if min(page.rect.width,page.rect.height)<10 or max(page.rect.width,page.rect.height)>4000:
                    return jsonify(error='页面尺寸超出支持范围'),400
                rules = inspect_page(page,len(doc),kind)
                pages.append(dict(rules=rules,symbols=identify_symbols(page),image=base64.b64encode(preview(page)).decode()))
            return jsonify(name=name,kind=kind,pages=pages)
    except (RuntimeError, ValueError, OverflowError):
        return jsonify(error='无法读取图纸，请检查 PDF 文件'),400
