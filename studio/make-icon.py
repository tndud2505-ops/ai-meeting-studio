from pathlib import Path
from PIL import Image
folder=Path(__file__).resolve().parent / 'public' / 'icons'
with Image.open(folder / 'icon-512.png') as image:
    image.save(folder / 'meeting.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
