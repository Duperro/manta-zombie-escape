FROM python:3.12-slim
WORKDIR /service
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY data ./data
ENV MANTA_DATA_DIR=/service/data
RUN pip install --no-cache-dir . && useradd --create-home backend
USER backend
EXPOSE 8000
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
