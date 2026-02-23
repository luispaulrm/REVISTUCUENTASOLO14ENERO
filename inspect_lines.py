
import os

filepath = r'c:\REVISATUCUENTASOLO14enero\server\services\gemini.service.ts'
with open(filepath, 'rb') as f:
    lines = f.readlines()

for i in range(80, 95):
    if i < len(lines):
        print(f"{i+1}: {repr(lines[i])}")
