FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# Copy application
COPY app.py .
COPY bookmark_parser.py .
COPY templates/ templates/
COPY static/ static/
COPY extension/ extension/

# Create data directory
RUN mkdir -p /app/data/uploads /app/data/icons /app/bookmarks

EXPOSE 5000

# Use gunicorn for production
RUN pip install --no-cache-dir gunicorn -i https://pypi.tuna.tsinghua.edu.cn/simple
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "--timeout", "120", "app:app"]
