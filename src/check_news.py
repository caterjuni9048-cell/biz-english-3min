"""오늘의 뉴스 파일 검사 + 목록(news/index.json) 갱신: python3 src/check_news.py news/2026-11-18.json (핫이슈: news/2026-11-18-hot.json)
문제가 있으면 이유를 출력하고 실패(종료 코드 1)한다."""
import sys, os, json, re
p = sys.argv[1]
n = json.load(open(p, encoding='utf-8'))
err = []
def need(c, m):
    if not c: err.append(m)
nid = os.path.splitext(os.path.basename(p))[0]
SUF = {'': 'biz', '-biz2': 'biz', '-hot': 'hot', '-ent': 'ent'}
suf = nid[len(n.get('date', '')):] if nid.startswith(n.get('date', '') or '#') else None
need(re.fullmatch(r'\d{4}-\d{2}-\d{2}', n.get('date', '')) and suf in SUF, '파일 이름은 <date>.json(경제1), <date>-biz2.json(경제2), <date>-hot.json(핫이슈), <date>-ent.json(스포츠·연예)')
kind = SUF.get(suf, 'biz')
need(n.get('kind', kind) == kind, 'kind 가 파일 이름과 맞지 않음(biz/hot/ent)')
for k in ['title', 'title_ko']: need(isinstance(n.get(k), str) and n[k].strip(), k + ' 없음')
paras, ko = n.get('paras', []), n.get('paras_ko', [])
need(isinstance(paras, list) and 2 <= len(paras) <= 4, 'paras 는 2~4문단')
need(isinstance(ko, list) and len(ko) == len(paras), 'paras_ko 문단 수가 paras 와 다름')
wc = sum(len(x.split()) for x in paras) if isinstance(paras, list) else 0
need(110 <= wc <= 200, '본문 단어 수 %d (110~200 이어야 함)' % wc)
src = n.get('sources', [])
need(isinstance(src, list) and src, 'sources 없음')
for s in src if isinstance(src, list) else []:
    need(isinstance(s, dict) and str(s.get('url', '')).startswith('https://') and s.get('name'), '출처에 name/https url 필요: %r' % s)
qs = n.get('qs', [])
need(isinstance(qs, list) and len(qs) == 3, '문제는 정확히 3개')
for q in qs if isinstance(qs, list) else []:
    need(q.get('q') and isinstance(q.get('opts'), list) and len(q['opts']) == 3 and isinstance(q.get('a'), int) and 0 <= q['a'] < 3 and q.get('why_ko'), '문제 형식 오류: %r' % q)
if isinstance(qs, list) and len(qs) == 3: need(len({q.get('a') for q in qs}) > 1, '정답 위치가 모두 같음')
ws = n.get('words', [])
need(isinstance(ws, list) and len(ws) == 5, '단어는 정확히 5개')
body = ' '.join(paras).lower() if isinstance(paras, list) else ''
for w in ws if isinstance(ws, list) else []:
    need(all(w.get(k) for k in ['en', 'ko', 'ex', 'ex_ko', 'ipa']) and w.get('cat') in ('m', 'p', 't'), '단어 형식 오류(ipa 없으면 news_audio.py 먼저): %r' % w)
    need(str(w.get('en', '')).lower().split()[0][:4] in body, '단어가 본문에 없음: %s' % w.get('en'))
    need(str(w.get('en', '')).lower().split()[0][:4] in str(w.get('ex', '')).lower(), '예문에 단어가 없음: %s' % w.get('ex'))
    need(w.get('aud') and os.path.exists(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(p))), w['aud'])), '예문 음성 없음 (src/news_audio.py 먼저 실행): %s' % w.get('ex'))
root = os.path.dirname(os.path.dirname(os.path.abspath(p)))
need(os.path.exists(root + '/news/audio/' + nid + '.mp3'), '음성 파일 없음 (src/news_audio.py 먼저 실행)')
if err:
    print('검사 실패:'); [print(' -', e) for e in err]; sys.exit(1)
ip = root + '/news/index.json'
idx = json.load(open(ip, encoding='utf-8')) if os.path.exists(ip) else []
for x in idx: x.setdefault('id', x['date']); x.setdefault('kind', 'biz')
idx = [x for x in idx if x['id'] != nid] + [{'id': nid, 'date': n['date'], 'kind': kind, 'title': n['title'], 'title_ko': n['title_ko']}]
ORD = {'biz': 0, 'hot': 1, 'ent': 2}
idx.sort(key=lambda x: (x['date'], ORD.get(x['kind'], 9), x['id'])); idx = idx[-200:]
json.dump(idx, open(ip, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('검사 통과: 본문 %d단어, 목록 %d개' % (wc, len(idx)))
