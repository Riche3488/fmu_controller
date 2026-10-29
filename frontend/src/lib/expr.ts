// 파생 신호 수식: 안전한 작은 식 언어. TS 평가(미리보기)와 Python/numpy 변환이 같은 의미를 갖는다.

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'col'; name: string }
  | { k: 'param'; name: string }
  | { k: 'un'; op: '-'; a: Expr }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '**'; a: Expr; b: Expr }
  | { k: 'call'; fn: ExprFn; args: Expr[] };

export const EXPR_FUNCS = [
  'sqrt', 'abs', 'sin', 'cos', 'tan', 'exp', 'log', 'log10', 'min', 'max', 'diff', 'cumsum',
] as const;
export type ExprFn = (typeof EXPR_FUNCS)[number];

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprError';
  }
}

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'tick'; v: string }
  | { t: 'str'; v: string }
  | { t: 'op'; v: string };

const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const ID_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(NUM_RE))) {
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if ((m = rest.match(ID_RE))) {
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end < 0) throw new ExprError('백틱(`)이 닫히지 않았습니다');
      if (end === i + 1) throw new ExprError('컬럼 이름이 비어 있습니다');
      out.push({ t: 'tick', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError('문자열이 닫히지 않았습니다');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (rest.startsWith('**')) {
      out.push({ t: 'op', v: '**' });
      i += 2;
    } else if ('+-*/(),[]'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else {
      throw new ExprError(`사용할 수 없는 문자: ${c}`);
    }
  }
  return out;
}

const isFn = (s: string): s is ExprFn => (EXPR_FUNCS as readonly string[]).includes(s);
const arity = (fn: ExprFn) => (fn === 'min' || fn === 'max' ? 2 : 1);

export function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peekOp = (v: string) => { const t = toks[p]; return t?.t === 'op' && t.v === v; };
  const eat = (v: string) => { if (peekOp(v)) { p++; return true; } return false; };

  function expectClose(what: string, ch: string) {
    if (!eat(ch)) throw new ExprError(`${what}가 닫히지 않았습니다`);
  }

  function sum(): Expr {
    let a = prod();
    for (;;) {
      if (eat('+')) a = { k: 'bin', op: '+', a, b: prod() };
      else if (eat('-')) a = { k: 'bin', op: '-', a, b: prod() };
      else return a;
    }
  }
  function prod(): Expr {
    let a = unary();
    for (;;) {
      if (eat('*')) a = { k: 'bin', op: '*', a, b: unary() };
      else if (eat('/')) a = { k: 'bin', op: '/', a, b: unary() };
      else return a;
    }
  }
  // 파이썬처럼 -x**2 = -(x**2)
  function unary(): Expr {
    if (eat('-')) return { k: 'un', op: '-', a: unary() };
    if (eat('+')) return unary();
    return power();
  }
  function power(): Expr {
    const a = atom();
    if (eat('**')) return { k: 'bin', op: '**', a, b: unary() }; // 우결합, 지수에 단항 허용
    return a;
  }
  function atom(): Expr {
    const t = toks[p];
    if (!t) throw new ExprError('식이 끝나기 전에 입력이 끝났습니다');
    if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
    if (t.t === 'tick') { p++; return { k: 'col', name: t.v }; }
    if (t.t === 'op' && t.v === '(') {
      p++;
      const e = sum();
      expectClose('괄호', ')');
      return e;
    }
    if (t.t === 'id') {
      p++;
      if (peekOp('(')) {
        if (!isFn(t.v)) throw new ExprError(`알 수 없는 함수: ${t.v}`);
        p++;
        const args: Expr[] = [];
        if (!peekOp(')')) {
          do args.push(sum()); while (eat(','));
        }
        expectClose('괄호', ')');
        if (args.length !== arity(t.v)) {
          throw new ExprError(`${t.v}는 인자 ${arity(t.v)}개가 필요합니다`);
        }
        return { k: 'call', fn: t.v, args };
      }
      if (t.v === 'params' && peekOp('[')) {
        p++;
        const s = toks[p];
        if (s?.t !== 'str') throw new ExprError('params[...] 안에는 "이름" 문자열이 필요합니다');
        p++;
        expectClose('대괄호', ']');
        return { k: 'param', name: s.v };
      }
      if (t.v.startsWith('params.') && t.v.length > 7) return { k: 'param', name: t.v.slice(7) };
      return { k: 'col', name: t.v };
    }
    throw new ExprError(`예상하지 못한 입력: ${t.v}`);
  }

  if (!toks.length) throw new ExprError('수식이 비어 있습니다');
  const e = sum();
  if (p < toks.length) {
    const t = toks[p];
    if (t.t === 'op' && t.v === ')') throw new ExprError('여는 괄호 없이 닫는 괄호가 있습니다');
    throw new ExprError(`예상하지 못한 입력: ${t.v}`);
  }
  return e;
}

function collect(e: Expr, kind: 'col' | 'param', out: string[]) {
  switch (e.k) {
    case 'col':
    case 'param':
      if (e.k === kind && !out.includes(e.name)) out.push(e.name);
      break;
    case 'un': collect(e.a, kind, out); break;
    case 'bin': collect(e.a, kind, out); collect(e.b, kind, out); break;
    case 'call': e.args.forEach((a) => collect(a, kind, out)); break;
    default: break;
  }
}
export function exprColumns(e: Expr): string[] {
  const out: string[] = [];
  collect(e, 'col', out);
  return out;
}
export function exprParams(e: Expr): string[] {
  const out: string[] = [];
  collect(e, 'param', out);
  return out;
}

type Val = number | Float64Array;

function map1(a: Val, n: number, f: (x: number) => number): Val {
  if (typeof a === 'number') return f(a);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = f(a[i]);
  return r;
}
function map2(a: Val, b: Val, n: number, f: (x: number, y: number) => number): Val {
  if (typeof a === 'number' && typeof b === 'number') return f(a, b);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = f(typeof a === 'number' ? a : a[i], typeof b === 'number' ? b : b[i]);
  }
  return r;
}

const FN1: Partial<Record<ExprFn, (x: number) => number>> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  exp: Math.exp, log: Math.log, log10: Math.log10,
};

export function evalExpr(
  e: Expr,
  cols: Record<string, Float64Array>,
  params: Record<string, number>,
  n: number,
): Float64Array {
  const go = (x: Expr): Val => {
    switch (x.k) {
      case 'num': return x.v;
      case 'col': {
        const c = cols[x.name];
        if (!c) throw new ExprError(`컬럼이 없습니다: ${x.name}`);
        return c;
      }
      case 'param': {
        const v = params[x.name];
        if (v === undefined) throw new ExprError(`파라미터가 없습니다: ${x.name}`);
        return v;
      }
      case 'un': return map1(go(x.a), n, (v) => -v);
      case 'bin': {
        const a = go(x.a);
        const b = go(x.b);
        switch (x.op) {
          case '+': return map2(a, b, n, (p, q) => p + q);
          case '-': return map2(a, b, n, (p, q) => p - q);
          case '*': return map2(a, b, n, (p, q) => p * q);
          case '/': return map2(a, b, n, (p, q) => p / q);
          default: return map2(a, b, n, Math.pow);
        }
      }
      case 'call': {
        const args = x.args.map(go);
        const f1 = FN1[x.fn];
        if (f1) return map1(args[0], n, f1);
        if (x.fn === 'min') return map2(args[0], args[1], n, Math.min);
        if (x.fn === 'max') return map2(args[0], args[1], n, Math.max);
        // diff·cumsum은 배열 연산이라 스칼라는 길이 n으로 늘려서 계산한다
        const a = typeof args[0] === 'number' ? new Float64Array(n).fill(args[0]) : args[0];
        const r = new Float64Array(n);
        if (x.fn === 'diff') {
          for (let i = 1; i < n; i++) r[i] = a[i] - a[i - 1];
        } else {
          let s = 0;
          for (let i = 0; i < n; i++) { s += a[i]; r[i] = s; }
        }
        return r;
      }
    }
  };
  const v = go(e);
  return typeof v === 'number' ? new Float64Array(n).fill(v) : v;
}

// 생성 코드는 `def _diff(x): return np.diff(x, prepend=x[0])` 도우미를 정의해야 한다.
const PREC = { add: 1, mul: 2, un: 3, pow: 4, atom: 5 };
const PY_FN: Record<ExprFn, string> = {
  sqrt: 'np.sqrt', abs: 'np.abs', sin: 'np.sin', cos: 'np.cos', tan: 'np.tan', exp: 'np.exp',
  log: 'np.log', log10: 'np.log10', min: 'np.minimum', max: 'np.maximum',
  diff: '_diff', cumsum: 'np.cumsum',
};

export function exprToPython(e: Expr, colVar: (name: string) => string): string {
  // [코드, 우선순위]
  const go = (x: Expr): [string, number] => {
    switch (x.k) {
      case 'num': return [String(x.v), x.v < 0 ? PREC.un : PREC.atom];
      case 'col': return [colVar(x.name), PREC.atom];
      case 'param': return [`float(params[${JSON.stringify(x.name)}])`, PREC.atom];
      case 'un': {
        const [s, p] = go(x.a);
        return [p < PREC.un || x.a.k === 'un' ? `-(${s})` : `-${s}`, PREC.un];
      }
      case 'bin': {
        const [sa, pa] = go(x.a);
        const [sb, pb] = go(x.b);
        const own = x.op === '+' || x.op === '-' ? PREC.add : x.op === '**' ? PREC.pow : PREC.mul;
        // 좌결합 연산: 오른쪽 자식은 같은 우선순위도 괄호. **: 왼쪽 자식은 같은/낮은 우선순위 괄호
        const wrapA = x.op === '**' ? pa <= PREC.pow : pa < own;
        const wrapB = x.op === '**' ? pb < PREC.un : pb <= own;
        return [`${wrapA ? `(${sa})` : sa} ${x.op} ${wrapB ? `(${sb})` : sb}`, own];
      }
      case 'call':
        return [`${PY_FN[x.fn]}(${x.args.map((a) => go(a)[0]).join(', ')})`, PREC.atom];
    }
  };
  return go(e)[0];
}
