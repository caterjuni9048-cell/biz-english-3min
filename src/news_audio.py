"""오늘의 뉴스 음성 + 단어 발음기호 만들기: python3 src/news_audio.py news/2026-11-18.json (핫이슈는 news/2026-11-18-hot.json)
- 음성 AI(Kokoro-82M, af_heart 목소리)를 처음 한 번 huggingface.co 에서 받아 ~/.cache/bizeng-kokoro 에 둔다.
- 결과: news/audio/<파일이름>.mp3, 그리고 words 마다 ipa(발음기호)를 채워 넣는다.
"""
import sys, os, json, subprocess, urllib.request
import numpy as np
D = os.path.expanduser('~/.cache/bizeng-kokoro')
B = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main'

def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 1000: return
    tmp = path + '.part'
    subprocess.run(['curl', '-sSLf', '-m', '600', '--retry', '3', '-o', tmp, url], check=True)
    os.replace(tmp, path)

def main(jpath):
    os.makedirs(D, exist_ok=True)
    get(B + '/onnx/model_quantized.onnx', D + '/model_q8.onnx')
    get(B + '/voices/af_heart.bin', D + '/af_heart.bin')
    if not os.path.exists(D + '/voices.npz'):
        v = np.fromfile(D + '/af_heart.bin', dtype=np.float32).reshape(-1, 1, 256)
        np.savez(D + '/voices.npz', af_heart=v)
    import soundfile as sf
    from kokoro_onnx import Kokoro
    kok = Kokoro(D + '/model_q8.onnx', D + '/voices.npz')
    n = json.load(open(jpath, encoding='utf-8'))
    nid = os.path.splitext(os.path.basename(jpath))[0]
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from ipa import ipa
    ws = n.get('words', [])
    if ws:
        for w, p in zip(ws, ipa([w['en'] for w in ws])): w['ipa'] = p
        json.dump(n, open(jpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    parts = []
    for para in [n['title']] + n['paras']:
        s, sr = kok.create(para, voice='af_heart', speed=0.9, lang='en-us')
        s = s / max(1e-6, float(abs(s).max())) * 0.85
        parts += [s.astype(np.float32), np.zeros(int(sr * 0.6), np.float32)]
    root = os.path.dirname(os.path.dirname(os.path.abspath(jpath)))
    os.makedirs(root + '/news/audio', exist_ok=True)
    wav = D + '/tmp.wav'; mp3 = root + '/news/audio/' + nid + '.mp3'
    sf.write(wav, np.concatenate([np.zeros(int(sr * 0.15), np.float32)] + parts), sr)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '24000', '-b:a', '48k', mp3], check=True)
    print('audio:', mp3, os.path.getsize(mp3), 'bytes')
    # 단어 예문마다 원어민 음성(내 문장에 추가했을 때 듣기·발음 비교 그래프에 씀)
    mp = root + '/news/ex-audio.json'
    exmap = json.load(open(mp, encoding='utf-8')) if os.path.exists(mp) else {}
    for k, w in enumerate(ws):
        s2, sr2 = kok.create(w['ex'], voice='af_heart', speed=0.9, lang='en-us')
        s2 = s2 / max(1e-6, float(abs(s2).max())) * 0.85
        pad = np.zeros(int(sr2 * 0.12), np.float32)
        sf.write(wav, np.concatenate([pad, s2.astype(np.float32), pad]), sr2)
        rel = 'news/audio/' + nid + '-w' + str(k) + '.mp3'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '24000', '-b:a', '64k', root + '/' + rel], check=True)
        w['aud'] = rel; exmap[w['ex']] = rel
        # 단어 발음(단어 스피드 퀴즈용)
        s3, sr3 = kok.create(w['en'].replace('~', '').strip(' ,'), voice='af_heart', speed=0.85, lang='en-us')
        s3 = s3 / max(1e-6, float(abs(s3).max())) * 0.85
        pad3 = np.zeros(int(sr3 * 0.08), np.float32)
        sf.write(wav, np.concatenate([pad3, s3.astype(np.float32), pad3]), sr3)
        relw = 'news/audio/' + nid + '-k' + str(k) + '.mp3'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '24000', '-b:a', '40k', root + '/' + relw], check=True)
        w['wa'] = relw
    json.dump(n, open(jpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(exmap, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print('word audio:', len(ws))

if __name__ == '__main__':
    main(sys.argv[1])
