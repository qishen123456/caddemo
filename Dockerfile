FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py inspect_pdf.py explanations.py symbols.py profile.json ./
COPY static static
COPY samples samples
USER 65534:65534
EXPOSE 8080
CMD ["gunicorn","--workers","2","--timeout","90","--bind","0.0.0.0:8080","app:app"]
