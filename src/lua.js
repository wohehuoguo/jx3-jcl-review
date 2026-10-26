/* A literal parser, not a Lua interpreter. No eval, code execution or prototypes. */
export function parseLua(source, maxDepth = 64) {
  let at = 0;
  const fail = message => { throw new SyntaxError(message + '（位置 ' + at + '）'); };
  const ws = () => { while (/\s/.test(source[at] || '') && at < source.length) at++; };
  function quoted() {
    const quote = source[at++];
    let out = '';
    while (at < source.length) {
      let c = source[at++];
      if (c === quote) return out;
      if (c !== '\\') { out += c; continue; }
      if (at >= source.length) fail('未结束的转义');
      c = source[at++];
      const escapes = {n:'\n', r:'\r', t:'\t', a:'\x07', b:'\b', f:'\f', v:'\v', '\\':'\\', '"':'"', "'":"'"};
      if (Object.hasOwn(escapes, c)) out += escapes[c];
      else if (/\d/.test(c)) {
        let digits = c;
        for (let i = 0; i < 2 && /\d/.test(source[at] || ''); i++) digits += source[at++];
        out += String.fromCharCode(Number(digits));
      } else if (c === '\n') out += '\n';
      else if (c === 'z') ws();
      else if (c === 'x') {
        const hex = source.slice(at, at + 2);
        if (!/^[a-f\d]{2}$/i.test(hex)) fail('无效十六进制转义');
        out += String.fromCharCode(parseInt(hex, 16)); at += 2;
      } else fail('不支持的转义');
    }
    fail('字符串未结束');
  }
  function value(depth) {
    if (depth > maxDepth) fail('表嵌套过深');
    ws();
    const c = source[at];
    if (c === '"' || c === "'") return quoted();
    if (c === '{') {
      at++; const table = Object.create(null); let next = 1;
      while (true) {
        ws();
        if (source[at] === '}') { at++; return table; }
        if (at >= source.length) fail('表未结束');
        let key, explicit = false;
        if (source[at] === '[') {
          at++; key = value(depth + 1); ws();
          if (source[at++] !== ']') fail('缺少右方括号');
          ws(); if (source[at++] !== '=') fail('缺少等号'); explicit = true;
        } else {
          const ident = source.slice(at).match(/^([A-Za-z_]\w*)\s*=/);
          if (ident) { key = ident[1]; at += ident[0].length; explicit = true; }
        }
        if (!explicit) key = next++;
        const v = value(depth + 1);
        if (key == null || typeof key === 'object') fail('无效表键');
        if (v !== null) table[String(key)] = v;
        ws();
        if (source[at] === ',' || source[at] === ';') { at++; continue; }
        if (source[at] !== '}') fail('缺少分隔符');
      }
    }
    for (const [word, v] of [['true', true], ['false', false], ['nil', null]]) {
      if (source.slice(at, at + word.length) === word && !/\w/.test(source[at + word.length] || '')) {
        at += word.length; return v;
      }
    }
    const number = source.slice(at).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      at += number[0].length;
      const n = Number(number[0]);
      if (!Number.isFinite(n)) fail('数值超出范围');
      if (/^[+-]?\d+$/.test(number[0]) && !Number.isSafeInteger(n)) return number[0].replace(/^\+/, '');
      return n;
    }
    // Historical JCL encoders used "-" for a missing sequential element.
    if (c === '-' && /[,;}\s]/.test(source[at + 1] || '')) { at++; return null; }
    fail('仅接受 Lua 字面量');
  }
  const result = value(0); ws();
  if (at !== source.length) fail('存在额外内容');
  return result;
}

export function decodeJcl(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return {text:new TextDecoder('utf-16le').decode(bytes), encoding:'UTF-16LE'};
  try { return {text:new TextDecoder('utf-8', {fatal:true}).decode(bytes), encoding:'UTF-8'}; }
  catch { return {text:new TextDecoder('gb18030', {fatal:true}).decode(bytes), encoding:'GB18030 / GBK'}; }
}
