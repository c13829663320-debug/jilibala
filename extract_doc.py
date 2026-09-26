import zipfile,sys,xml.etree.ElementTree as ET
p=sys.argv[1]
with zipfile.ZipFile(p) as z:
 root=ET.fromstring(z.read('word/document.xml'))
 ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
 for para in root.findall('.//w:p',ns):
  print(''.join(t.text or '' for t in para.findall('.//w:t',ns)))
