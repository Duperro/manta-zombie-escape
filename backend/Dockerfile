FROM python:3.12-slim@sha256:12316debbfb86890f6b2d825820612741ba527ad5a44e3902759141d572bfe8f
WORKDIR /service
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY data ./data
ENV MANTA_DATA_DIR=/service/data \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir . && useradd --create-home backend
USER backend
EXPOSE 8000
CMD ["python", "-m", "app.container_server"]
