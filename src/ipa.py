"""영어 단어 → 사전식 발음기호(미국식). espeak-ng 로 만든 뒤 사전 표기에 가깝게 다듬는다.
사용: from ipa import ipa; ipa("quotation") -> "/kwoʊˈteɪʃən/" """
import re
_P = None
def _ph():
    global _P
    if _P is None:
        import espeakng_loader
        from phonemizer.backend.espeak.wrapper import EspeakWrapper
        EspeakWrapper.set_library(espeakng_loader.get_library_path())
        EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
        from phonemizer.backend import EspeakBackend
        _P = EspeakBackend('en-us', with_stress=True)
    return _P
V = 'aeiouɑæɐɒɔəɚɛɜɪʊʌᵻ'
ONSET2 = {'pr','pl','br','bl','tr','dr','kr','kl','gr','gl','fr','fl','θr','ʃr','sp','st','sk','sm','sn','sl','sw','tw','kw','dw','pj','bj','kj','fj','mj','hj','nj','vj'}
def _units(s):
    out, i = [], 0
    while i < len(s):
        if s[i:i+2] in ('tʃ', 'dʒ'): out.append(s[i:i+2]); i += 2
        else: out.append(s[i]); i += 1
    return out
def _fix(s):
    s = s.replace('ɚɹ', 'ɚ').replace('ɹ', 'r').replace('ɐ', 'ə').replace('ᵻ', 'ɪ').replace('ɾ', 't').replace('ɚ', 'ər').replace('ʔ', 't')
    s = re.sub(r'ɜː(?!r)', 'ɜːr', s)
    u = _units(s)
    i = 0
    while i < len(u):
        if u[i] in 'ˈˌ':
            m = u.pop(i); j = i
            cons = []
            while j > 0 and u[j-1] not in V and u[j-1] not in 'ːˈˌ' and len(cons) < 3:
                cons.insert(0, u[j-1]); j -= 1
            take = 0
            if len(cons) >= 2 and ''.join(cons[-2:]) in ONSET2: take = 2
            elif len(cons) >= 1: take = 1
            if j == 0 and len(cons) <= 3 and take < len(cons) and ''.join(cons) in ONSET2 | {'spr','str','skr','spl','skw'}: take = len(cons)
            u.insert(i - take, m); i += 1
        i += 1
    s = ''.join(u)
    if len(re.findall('[' + V + ']+', s)) <= 1: s = s.replace('ˈ', '').replace('ˌ', '')
    return s
# espeak 가 틀리게 내는 단어는 사전 표기로 고정
FIX = {'interrupt': '/ˌɪntəˈrʌpt/', 'cooperation': '/koʊˌɑːpəˈreɪʃən/', 'quantity': '/ˈkwɑːntəti/',
       'inconvenience': '/ˌɪnkənˈviːniəns/', 'increased': '/ɪnˈkriːst/', 'exchange': '/ɪksˈtʃeɪndʒ/',
       'schedule': '/ˈskɛdʒuːl/', 'colleague': '/ˈkɑːliːɡ/', 'purchase': '/ˈpɜːrtʃəs/'}
def ipa(words):
    single = isinstance(words, str)
    ws = [words] if single else list(words)
    res = ['/' + _fix(x.strip()) + '/' for x in _ph().phonemize([w.lower() for w in ws], strip=True)]
    res = [FIX.get(w.lower(), r) for w, r in zip(ws, res)]
    return res[0] if single else res
if __name__ == '__main__':
    import sys
    for w, p in zip(sys.argv[1:], ipa(sys.argv[1:])): print(w, p)
