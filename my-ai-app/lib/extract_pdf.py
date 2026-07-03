import sys
import io
from PyPDF2 import PdfReader

# Windows 默认 GBK，改成 UTF-8 才能正常输出中文和特殊字符
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

reader = PdfReader(sys.argv[1])
text = ""
for page in reader.pages:
    t = page.extract_text()
    if t:
        text += t + "\n"
print(text)
