import json,shutil
from PIL import Image,ImageDraw,ImageFont
R='/home/user/biz-english-3min'
src=open('/home/user/biz-english-3min/src/app-source.html',encoding='utf8').read()
i=src.index('<div id="app"></div>')
head,body=src[:i],src[i:]
head=head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n','')
doc='''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#1B55C8">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="3분 영어">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-180.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
'''+head+'</head>\n<body>\n'+body+'\n</body>\n</html>\n'
open(f'{R}/index.html','w',encoding='utf8').write(doc)
shutil.copy('/home/user/biz-english-audio.js',f'{R}/audio.js')
json.dump({"name":"3분 비즈니스 영어","short_name":"3분 영어","start_url":"./","scope":"./","display":"standalone","background_color":"#EEF1F5","theme_color":"#1B55C8","lang":"ko",
 "icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]},
 open(f'{R}/manifest.json','w',encoding='utf8'),ensure_ascii=False,indent=1)
F='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
for s in (180,192,512):
    im=Image.new('RGB',(s,s),'#1B55C8'); d=ImageDraw.Draw(im)
    f1=ImageFont.truetype(F,int(s*0.42)); f2=ImageFont.truetype(F,int(s*0.15))
    d.text((s/2,s*0.44),"3",font=f1,fill='white',anchor='mm')
    d.text((s/2,s*0.76),"MIN EN",font=f2,fill='#CFE0FF',anchor='mm')
    im.save(f'{R}/icon-{s}.png')
print('built')
