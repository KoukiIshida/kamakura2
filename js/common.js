/* =========================================================================
 * common.js
 * 参加者ページ・管理ページの両方で使う共通処理
 *  - 答えの正規化＆SHA-256ハッシュ化（答えの隠蔽）
 *  - ニックネームの条件判定（分岐ロジック）
 *  - 設定ファイル(settings.json)の読み込み
 * ========================================================================= */

/* -------------------------------------------------------------------------
 * 答えの正規化
 *  ガイドライン(answer-hiding-guide)と同じルール:
 *   - 前後の空白を除去
 *   - 英字は小文字化
 *   - 全角英数字 → 半角英数字
 *  ※ 管理ページでハッシュ化するときも、参加者ページで照合するときも
 *    必ずこの同じ関数を通すこと（ズレると正解判定できなくなる）
 * ----------------------------------------------------------------------- */
function normalizeAnswer(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
    });
}

/* -------------------------------------------------------------------------
 * 答えをSHA-256でハッシュ化（16進文字列を返す）
 *  Web Crypto API を使用。
 *  ※ crypto.subtle は「安全なコンテキスト」でのみ動作する。
 *    → http://localhost（Live Server）や https://（GitHub Pages）はOK。
 *    → file:// で直接HTMLを開くと動かないことがあるので Live Server 推奨。
 * ----------------------------------------------------------------------- */
async function hashAnswer(text) {
  var normalized = normalizeAnswer(text);
  var encoded = new TextEncoder().encode(normalized);
  var hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  var hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map(function (b) {
      return b.toString(16).padStart(2, '0');
    })
    .join('');
}

/* -------------------------------------------------------------------------
 * ニックネームを「見た目の1文字」単位の配列にする
 *  Array.from を使うことで、サロゲートペア（絵文字等）も1文字として扱う。
 *  日本語（ひらがな/カタカナ/漢字）はこれで問題なくカウントできる。
 * ----------------------------------------------------------------------- */
function nicknameChars(nickname) {
  return Array.from(String(nickname).trim());
}

/* -------------------------------------------------------------------------
 * 1つの条件を判定する
 *  condition の形:
 *   { kind: 'length',     op: 'eq'|'ne'|'lte'|'gte'|'lt'|'gt'|'odd'|'even', value: 数値 }
 *   { kind: 'charAt',     pos: 1始まりの位置, value: '1文字' }
 *   { kind: 'startsWith', value: '文字列' }   … 前方一致
 *   { kind: 'endsWith',   value: '文字列' }   … 後方一致
 *   { kind: 'contains',   value: '文字列' }   … 含む
 *   { kind: 'equals',     value: '文字列' }   … 完全一致
 *  どの条件にも { not: true } を付けると判定を反転できる
 *  （例: charAt + not = 「N文字目が〇 ではない」）
 * ----------------------------------------------------------------------- */
function matchCondition(nickname, condition) {
  var nick = String(nickname).trim();
  var chars = nicknameChars(nick);
  var len = chars.length;

  var result;
  switch (condition.kind) {
    case 'length': {
      var v = Number(condition.value);
      switch (condition.op) {
        case 'eq':   result = len === v; break;
        case 'ne':   result = len !== v; break;
        case 'lte':  result = len <= v; break;
        case 'gte':  result = len >= v; break;
        case 'lt':   result = len < v; break;
        case 'gt':   result = len > v; break;
        case 'odd':  result = len % 2 === 1; break;
        case 'even': result = len % 2 === 0; break;
        default:     result = false;
      }
      break;
    }
    case 'charAt': {
      var pos = Number(condition.pos); // 1始まり
      result = (pos >= 1 && pos <= len) && chars[pos - 1] === condition.value;
      break;
    }
    case 'startsWith':
      result = condition.value !== '' && nick.startsWith(condition.value);
      break;
    case 'endsWith':
      result = condition.value !== '' && nick.endsWith(condition.value);
      break;
    case 'contains':
      result = condition.value !== '' && nick.indexOf(condition.value) !== -1;
      break;
    case 'equals':
      result = nick === condition.value;
      break;
    default:
      result = false;
  }

  return condition.not ? !result : result;
}

/* -------------------------------------------------------------------------
 * 1つのルールを判定する（ルール内の条件はすべてAND）
 *  条件が0個のルールは「マッチしない」扱い（誤爆防止）。
 * ----------------------------------------------------------------------- */
function matchRule(nickname, rule) {
  var conditions = rule.conditions || [];
  if (conditions.length === 0) return false;
  return conditions.every(function (c) {
    return matchCondition(nickname, c);
  });
}

/* -------------------------------------------------------------------------
 * 分岐問題から、このニックネームに出す内容を決定する
 *  rules を上から順にチェックし、最初にマッチしたルールを採用。
 *  どれにもマッチしなければ default を返す。
 *  戻り値: { questionText, image, answerHash } のオブジェクト（無ければ null）
 * ----------------------------------------------------------------------- */
function resolveBranch(nickname, branchQuestion) {
  var rules = branchQuestion.rules || [];
  for (var i = 0; i < rules.length; i++) {
    if (matchRule(nickname, rules[i])) {
      return rules[i];
    }
  }
  return branchQuestion.default || null;
}

/* -------------------------------------------------------------------------
 * 問題文の差し込みタグを、ニックネームの内容で置き換える
 *  使えるタグ:
 *   {ニックネーム}   … ニックネーム全体
 *   {呼び名}         … ニックネーム＋呼び方（例: たろうくん）
 *   {1文字目}        … 1文字目（{2文字目}…と数字を変えられる。全角数字もOK）
 *   {最後の文字}     … 最後の1文字
 *   {文字数}         … 文字数
 *  該当する文字が無い場合（例: ニックネームより大きい位置）は空文字に置き換える。
 *  displayName を省略した場合は {呼び名} はニックネームのみになる。
 * ----------------------------------------------------------------------- */
function applyNicknameTemplate(text, nickname, displayName) {
  if (!text) return '';
  var chars = nicknameChars(nickname);
  var len = chars.length;
  var out = String(text);

  out = out.replace(/\{\s*呼び名\s*\}/g, displayName != null ? displayName : nickname);
  out = out.replace(/\{\s*ニックネーム\s*\}/g, nickname);
  out = out.replace(/\{\s*文字数\s*\}/g, String(len));
  out = out.replace(/\{\s*最後の文字\s*\}/g, len > 0 ? chars[len - 1] : '');
  out = out.replace(/\{\s*([0-9０-９]+)\s*文字目\s*\}/g, function (m, digits) {
    var half = digits.replace(/[０-９]/g, function (s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
    });
    var n = Number(half);
    return (n >= 1 && n <= len) ? chars[n - 1] : '';
  });

  return out;
}

/* -------------------------------------------------------------------------
 * 1文字の「文字種」を判定する
 *  戻り値: 'hiragana' | 'katakana' | 'kanji' | 'alpha' | 'digit' | 'other'
 * ----------------------------------------------------------------------- */
function charType(ch) {
  if (/[぀-ゟ]/.test(ch)) return 'hiragana';                  // ひらがな
  if (/[゠-ヿｦ-ﾟ]/.test(ch)) return 'katakana';     // カタカナ（半角含む）
  if (/[一-鿿㐀-䶿々]/.test(ch)) return 'kanji';  // 漢字（々含む）
  if (/[A-Za-zＡ-Ｚａ-ｚ]/.test(ch)) return 'alpha';  // 英字（全角含む）
  if (/[0-9０-９]/.test(ch)) return 'digit';                  // 数字（全角含む）
  return 'other';
}

/* 文字種コード → 日本語ラベル */
var NICK_TYPE_LABELS = {
  hiragana: 'ひらがな',
  katakana: 'カタカナ',
  kanji: '漢字',
  alpha: '英字',
  digit: '数字'
};
function nicknameTypeLabels(types) {
  return (types || []).map(function (t) { return NICK_TYPE_LABELS[t] || t; }).join('・');
}

/* -------------------------------------------------------------------------
 * ニックネーム登録ルールの説明文（入力欄の下に出す案内用）
 *  rule: { minLength, maxLength(0=無制限), allowedTypes:[] }
 * ----------------------------------------------------------------------- */
function describeNicknameRule(rule) {
  rule = rule || {};
  var parts = [];
  var types = rule.allowedTypes || [];
  if (types.length) parts.push(nicknameTypeLabels(types));
  var min = Number(rule.minLength) || 0;
  var max = Number(rule.maxLength) || 0;
  if (min && max) parts.push(min + '〜' + max + '文字');
  else if (min) parts.push(min + '文字以上');
  else if (max) parts.push(max + '文字以内');
  return parts.length ? '※ ' + parts.join('／') + 'で入力してください' : '';
}

/* -------------------------------------------------------------------------
 * ニックネームがルールを満たすか判定する
 *  戻り値: { ok: true } または { ok: false, message: 'エラー文' }
 * ----------------------------------------------------------------------- */
function validateNickname(nickname, rule) {
  rule = rule || {};
  var nick = String(nickname).trim();
  var chars = nicknameChars(nick);
  var len = chars.length;

  if (len === 0) return { ok: false, message: 'ニックネームを入力してください。' };

  var min = Number(rule.minLength) || 0;
  var max = Number(rule.maxLength) || 0; // 0 = 無制限
  if (min && len < min) return { ok: false, message: 'ニックネームは' + min + '文字以上で入力してください。' };
  if (max && len > max) return { ok: false, message: 'ニックネームは' + max + '文字以内で入力してください。' };

  var types = rule.allowedTypes || [];
  if (types.length) {
    for (var i = 0; i < chars.length; i++) {
      if (types.indexOf(charType(chars[i])) === -1) {
        return { ok: false, message: 'ニックネームは' + nicknameTypeLabels(types) + 'のみで入力してください。' };
      }
    }
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------
 * settings.json を読み込む
 * ----------------------------------------------------------------------- */
async function loadSettings(path) {
  var url = path || 'settings.json';
  var res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('settings.json を読み込めませんでした (HTTP ' + res.status + ')');
  }
  return res.json();
}

/* -------------------------------------------------------------------------
 * 条件を日本語の説明文にする（管理ページのプレビュー用）
 * ----------------------------------------------------------------------- */
function describeCondition(c) {
  var neg = !!c.not;
  switch (c.kind) {
    case 'length': {
      var opText = {
        eq: '＝', ne: '≠', lte: '以下', gte: '以上',
        lt: '未満', gt: 'より多い', odd: '奇数', even: '偶数'
      }[c.op] || '';
      var base;
      if (c.op === 'odd' || c.op === 'even') base = '文字数が' + opText;
      else if (c.op === 'eq' || c.op === 'ne') base = '文字数' + opText + c.value;
      else base = '文字数が' + c.value + opText;
      return neg ? base + ' ではない' : base;
    }
    case 'charAt':     return c.pos + '文字目が「' + c.value + '」' + (neg ? 'ではない' : '');
    case 'startsWith': return '「' + c.value + (neg ? '」で始まらない' : '」で始まる');
    case 'endsWith':   return '「' + c.value + (neg ? '」で終わらない' : '」で終わる');
    case 'contains':   return '「' + c.value + (neg ? '」を含まない' : '」を含む');
    case 'equals':     return '「' + c.value + (neg ? '」と一致しない' : '」と完全一致');
    default:           return '(不明な条件)';
  }
}
