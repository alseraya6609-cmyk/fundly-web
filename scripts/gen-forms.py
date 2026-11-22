import re, json, sys
import os
# الاستعمال: python scripts/gen-forms.py C:\Users\alzai\fundly
# يقرأ نماذج «أنا» من التطبيق ويكتب client/lib/personalForms.gen.ts.
APP = sys.argv[1] if len(sys.argv) > 1 else sys.exit('اكتب مسار مجلد التطبيق')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(APP, 'lib', 'screens', 'personal_commitments_screen.dart'), encoding='utf-8').read()

def strip_comments(s):
    out=[];i=0;n=len(s)
    while i<n:
        c=s[i]
        if c in "'\"":
            q=c; j=i+1
            # triple?
            if s.startswith(q*3,i):
                j=s.index(q*3,i+3)+3; out.append(s[i:j]); i=j; continue
            while j<n and s[j]!=q:
                if s[j]=='\\': j+=2
                else: j+=1
            out.append(s[i:j+1]); i=j+1; continue
        if s.startswith('//',i):
            j=s.find('\n',i); i=n if j<0 else j; continue
        if s.startswith('/*',i):
            j=s.index('*/',i)+2; i=j; continue
        out.append(c); i+=1
    return ''.join(out)
s = strip_comments(src)

TOK = re.compile(r"\s*(?:(?P<str>r?'(?:[^'\\]|\\.)*'|r?\"(?:[^\"\\]|\\.)*\")|(?P<num>\d+(?:\.\d+)?)|(?P<spread>\.\.\.\??)|(?P<id>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)|(?P<p>[\[\](){}:,<>?=]))")
def tokenize(t):
    pos=0; toks=[]
    while pos<len(t):
        m=TOK.match(t,pos)
        if not m:
            if t[pos:].strip()=='' : break
            raise SyntaxError(t[pos:pos+80])
        pos=m.end()
        k=m.lastgroup; toks.append((k,m.group(k)))
    return toks

def unq(x):
    raw = x.startswith('r')
    if raw: x=x[1:]
    body=x[1:-1]
    if not raw:
        body=re.sub(r"\\(.)", lambda m: {'n':'\n','t':'\t'}.get(m.group(1),m.group(1)), body)
    return body

class P:
    def __init__(s,toks): s.t=toks; s.i=0
    def peek(s,o=0): return s.t[s.i+o] if s.i+o<len(s.t) else (None,None)
    def take(s,v=None):
        tok=s.t[s.i]; s.i+=1
        if v and tok[1]!=v: raise SyntaxError(f'expected {v} got {tok}')
        return tok
    def expr(s):
        k,v=s.peek()
        if k=='str':
            out=''
            while s.peek()[0]=='str': out+=unq(s.take()[1])
            return out
        if k=='num': s.take(); return float(v) if '.' in v else int(v)
        if v=='[': 
            s.take(); items=[]
            while s.peek()[1]!=']':
                if s.peek()[0]=='spread': s.take(); items.append(('SPREAD',s.expr()))
                else: items.append(s.expr())
                if s.peek()[1]==',': s.take()
            s.take(']'); return items
        if v=='{':
            s.take(); d={}
            while s.peek()[1]!='}':
                key=s.expr(); s.take(':'); d[key]=s.expr()
                if s.peek()[1]==',': s.take()
            s.take('}'); return d
        if k=='id':
            s.take()
            if v in ('true','false'): return v=='true'
            if v=='const': return s.expr()
            if s.peek()[1]=='<':  # generic
                depth=0
                while True:
                    tk=s.take()[1]
                    if tk=='<': depth+=1
                    elif tk=='>':
                        depth-=1
                        if depth==0: break
            if s.peek()[1]=='(':
                s.take(); args=[]; named={}
                while s.peek()[1]!=')':
                    if s.peek()[0]=='id' and s.peek(1)[1]==':':
                        name=s.take()[1]; s.take(':'); named[name]=s.expr()
                    else: args.append(s.expr())
                    if s.peek()[1]==',': s.take()
                s.take(')'); return ('CALL',v,args,named)
            return ('REF',v)
        raise SyntaxError(f'bad token {k} {v} at {s.i}')

def top_const(name):
    m=re.search(r'\nconst\s+(?:[\w<>, ]+\s+)?'+re.escape(name)+r'\s*=\s*', s)
    if not m: return None
    p=P(tokenize(s[m.end():m.end()+60000].split(';\n')[0]))
    return p.expr()

consts={'kReminderLeadOptions':['قبل يوم','قبل 12 ساعة','قبل ساعة','مخصص بالساعات','مخصص بالأيام'],
        'AppSettings.currencySuffixes':['جنيه سوداني','جنيه مصري','درهم','دولار','دينار أردني','دينار بحريني','دينار','روبية باكستانية','روبية هندية','ريال','ريال عماني','ريال قطري','ليرة سورية','ليرة لبنانية','يوان صيني','يورو']}
def resolve(x):
    if isinstance(x,tuple) and x[0]=='REF':
        name=x[1]
        if name not in consts:
            v=top_const(name)
            if v is None: raise KeyError(name)
            consts[name]=resolve(v)
        return consts[name]
    if isinstance(x,list):
        out=[]
        for it in x:
            if isinstance(it,tuple) and it[0]=='SPREAD': out.extend(resolve(it[1]))
            else: out.append(resolve(it))
        return out
    if isinstance(x,dict): return {k:resolve(v) for k,v in x.items()}
    if isinstance(x,tuple) and x[0]=='CALL':
        _,fn,args,named=x
        if fn=='_FinancialField':
            f={'label':resolve(args[0])}
            kind=named.get('kind')
            f['kind']= kind[1].split('.')[-1] if kind else 'text'
            for key in ['required','isPrimary','isTitle','isAmount','allowCustom','half','hidden']:
                if named.get(key): f[key]=True
            if 'options' in named: f['options']=resolve(named['options'])
            for key in ['hint','display']:
                if named.get(key): f[key]=named[key]
            return f
        if fn=='_FinancialEntryForm':
            return {'label':named['label'],'subtitle':named['subtitle'],'fields':resolve(named['fields'])}
        return ('CALL',fn)
    return x

forms_all = resolve(top_const('_financialEntryForms'))
subs = {k: resolve(top_const(k)) for k in ['_expenseSubcategoriesByMainCategory','_incomeSubcategoriesByMainCategory','_fineSubcategoriesByMainCategory']}
# الأنواع المتاحة للإضافة في الموقع (ADD_MENU في personalWrite.ts).
SUPPORTED=['المصروفات الشخصية','إيراد','تحويل مالي','دين / قرض / سلفة','قسط','غرامة','عهدة مالية','أدوية','مستند','مهمة','موعد','عادة','تذكير','ملاحظات','كلمات سر','مناسبة','اشتراك','هدية','مواقع وأماكن']
# والأنواع القديمة (ليست في قائمة الإضافة) لتعديل سجلاتها الموجودة بنموذجها.
forms={k:forms_all[k] for k in SUPPORTED + [k for k in forms_all if k not in SUPPORTED]}
for k,f in forms.items():
    for fld in f['fields']:
        assert isinstance(fld,dict), (k,fld)
out = "/* مولَّد من التطبيق (personal_commitments_screen.dart ← _financialEntryForms\n   وجداول التصنيفات) بالسكربت scripts/gen-forms.py، لا يُعدَّل يدويًا. */\n\n"
out += "export type FieldKind = 'text' | 'number' | 'date' | 'time' | 'multiline' | 'secret' | 'select' | 'toggle' | 'header'\n"
out += "export type FormField = {\n  label: string\n  kind: FieldKind\n  required?: boolean\n  isPrimary?: boolean\n  isTitle?: boolean\n  isAmount?: boolean\n  allowCustom?: boolean\n  half?: boolean\n  hidden?: boolean\n  options?: string[]\n  hint?: string\n  display?: string\n}\n"
out += "export type EntryForm = { label: string; subtitle: string; fields: FormField[] }\n\n"
out += "export const FORMS: Record<string, EntryForm> = " + json.dumps(forms, ensure_ascii=False, indent=2) + "\n\n"
out += "export const EXPENSE_SUBCATEGORIES: Record<string, string[]> = " + json.dumps(subs['_expenseSubcategoriesByMainCategory'], ensure_ascii=False, indent=2) + "\n\n"
out += "export const INCOME_SUBCATEGORIES: Record<string, string[]> = " + json.dumps(subs['_incomeSubcategoriesByMainCategory'], ensure_ascii=False, indent=2) + "\n\n"
out += "export const FINE_SUBCATEGORIES: Record<string, string[]> = " + json.dumps(subs['_fineSubcategoriesByMainCategory'], ensure_ascii=False, indent=2) + "\n"
open(os.path.join(ROOT, 'client', 'lib', 'personalForms.gen.ts'), 'w', encoding='utf-8', newline='\n').write(out)
print('personalForms.gen.ts:', len(forms), 'نموذجًا')
