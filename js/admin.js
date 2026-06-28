/* =========================================================================
 * admin.js  ―  管理ページのロジック（あなただけが使う想定）
 *  - 問題（通常／分岐）とニックネーム条件ルールをGUIで編集
 *  - 下書きは localStorage に自動保存（答えは平文のまま、この端末内だけ）
 *  - 「書き出す」で settings.json を生成（答えはSHA-256でハッシュ化）
 * ========================================================================= */

(function () {
  'use strict';

  var DRAFT_KEY = 'nickname-quiz-admin-draft';

  // 編集中のデータ（このオブジェクトが常に正）
  var draft = {
    title: '',
    description: '',
    nicknameRule: { minLength: '', maxLength: '', allowedTypes: [], askSuffix: false },
    questions: []
  };

  // 要素
  var container = document.getElementById('questions-container');
  var titleInput = document.getElementById('app-title-input');
  var descInput = document.getElementById('app-desc-input');
  var statusBox = document.getElementById('status');
  var nickMinInput = document.getElementById('nick-min');
  var nickMaxInput = document.getElementById('nick-max');
  var nickTypeBoxes = Array.prototype.slice.call(
    document.querySelectorAll('#nick-types input[type="checkbox"]')
  );
  var nickAskSuffix = document.getElementById('nick-ask-suffix');

  /* ----- 小さなDOMヘルパー ----------------------------------------------- */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'class') node.className = props[k];
        else if (k === 'text') node.textContent = props[k];
        else if (k === 'value') node.value = props[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), props[k]);
        else node.setAttribute(k, props[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /* ----- 下書きの保存／読み込み ------------------------------------------ */
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
      /* localStorageが使えない環境でも編集自体は継続できるように握りつぶす */
    }
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        draft.title = parsed.title || '';
        draft.description = parsed.description || '';
        draft.nicknameRule = parsed.nicknameRule || { minLength: '', maxLength: '', allowedTypes: [], askSuffix: false };
        draft.questions = parsed.questions || [];
        return true;
      }
    } catch (e) { /* 壊れた下書きは無視 */ }
    return false;
  }

  /* 変更があるたびに呼ぶ：下書き保存＋（必要なら）再描画 */
  function touched(rerender) {
    saveDraft();
    if (rerender) render();
  }

  /* ----- 雛形 ------------------------------------------------------------ */
  function newFixed() {
    return { type: 'fixed', _open: true, answerMode: 'fixed', text: '', image: '', answer: '', answerHashes: [] };
  }
  function newVariant() {
    return { questionText: '', image: '', answer: '', answerHashes: [] };
  }
  function newBranch() {
    return { type: 'branch', _open: true, answerMode: 'fixed', rules: [newRule()], default: newVariant() };
  }
  function newRule() {
    return {
      label: '', conditions: [newCondition()],
      questionText: '', image: '', answer: '', answerHashes: []
    };
  }
  function newCondition() {
    return { kind: 'length', op: 'eq', value: '', pos: '1', not: false };
  }

  /* =======================================================================
   * 描画
   * ===================================================================== */
  function render() {
    titleInput.value = draft.title;
    descInput.value = draft.description;
    syncNicknameRuleUI();

    container.innerHTML = '';
    if (draft.questions.length === 0) {
      container.appendChild(el('p', { class: 'note', text: 'まだ問題がありません。下のボタンから追加してください。' }));
    }
    draft.questions.forEach(function (q, qi) {
      container.appendChild(renderQuestion(q, qi));
    });
  }

  /* ニックネーム登録ルールの入力欄を draft の値に合わせる */
  function syncNicknameRuleUI() {
    var rule = draft.nicknameRule || { minLength: '', maxLength: '', allowedTypes: [], askSuffix: false };
    nickMinInput.value = rule.minLength === 0 ? '0' : (rule.minLength || '');
    nickMaxInput.value = rule.maxLength === 0 ? '0' : (rule.maxLength || '');
    var types = rule.allowedTypes || [];
    nickTypeBoxes.forEach(function (cb) {
      cb.checked = types.indexOf(cb.getAttribute('data-type')) !== -1;
    });
    nickAskSuffix.checked = !!rule.askSuffix;
  }

  /* 折りたたみ時にも内容がわかる短い要約 */
  function questionSummary(q) {
    if (q.type === 'branch') {
      return 'ルール' + (q.rules ? q.rules.length : 0) + '件';
    }
    var t = (q.text || '').replace(/\s+/g, ' ').trim();
    return t ? (t.length > 24 ? t.slice(0, 24) + '…' : t) : '（問題文なし）';
  }

  function renderQuestion(q, qi) {
    var isBranch = q.type === 'branch';
    var isOpen = !!q._open;

    // クリックで開閉するトグル部分（▸/▾ ＋ ラベル）
    var caret = el('span', { class: 'q-caret', text: isOpen ? '▾' : '▸' });
    var tag = el('span', {
      class: 'q-tag' + (isBranch ? ' branch' : ''),
      text: '問題 ' + (qi + 1) + '：' + (isBranch ? 'ニックネームで分岐' : '通常（全員共通）')
    });
    var summary = el('span', { class: 'q-summary', text: questionSummary(q) });

    var body; // ← 先に宣言（トグルから参照するため）

    var toggle = el('div', {
      class: 'q-toggle',
      onclick: function () {
        q._open = !q._open;
        saveDraft();
        caret.textContent = q._open ? '▾' : '▸';
        body.classList.toggle('hidden', !q._open);
      }
    }, [caret, tag, summary]);

    var head = el('div', { class: 'q-block-head' }, [
      toggle,
      el('div', { class: 'toolbar' }, [
        el('button', {
          class: 'btn btn-ghost btn-small', text: '▲',
          onclick: function () { moveQuestion(qi, -1); }
        }),
        el('button', {
          class: 'btn btn-ghost btn-small', text: '▼',
          onclick: function () { moveQuestion(qi, 1); }
        }),
        el('button', {
          class: 'btn btn-danger btn-small', text: '削除',
          onclick: function () {
            if (confirm('この問題を削除しますか？')) {
              draft.questions.splice(qi, 1); touched(true);
            }
          }
        })
      ])
    ]);

    if (isBranch) {
      body = renderBranchBody(q);
    } else {
      var hideAnswer = q.answerMode === 'nickname';
      body = el('div', {}, [
        renderAnswerModeRow(q),
        renderVariantFields(q, '問題文', 'text', hideAnswer)
      ]);
    }
    body.classList.toggle('hidden', !isOpen);

    return el('div', { class: 'q-block' }, [head, body]);
  }

  /* 「答えを参加者のニックネームにする」チェックボックス（問題単位） */
  function renderAnswerModeRow(q) {
    var cb = el('input', {
      type: 'checkbox',
      onchange: function (e) {
        q.answerMode = e.target.checked ? 'nickname' : 'fixed';
        touched(true);
      }
    });
    cb.checked = q.answerMode === 'nickname';

    var label = el('label', {
      style: 'display:flex;align-items:flex-start;gap:8px;font-weight:600;color:#1f6d3f;cursor:pointer;'
    }, [
      cb,
      document.createTextNode('答えを「参加者が登録したニックネーム」にする（どの問題が出ても、正解＝そのニックネーム）')
    ]);

    return el('div', {
      class: 'row',
      style: 'background:#eefaf1;border:1px solid #bfe6cd;border-radius:8px;padding:10px 12px;'
    }, [label]);
  }

  /* 通常問題 / 分岐の各バリエーション共通の入力欄
   *  textKey: 'text'（通常） or 'questionText'（分岐内）
   *  hideAnswer: true なら答え欄を出さない（＝答えはニックネームモード） */
  function renderVariantFields(obj, textLabel, textKey, hideAnswer) {
    var hasExistingHash = !obj.answer && obj.answerHashes && obj.answerHashes.length > 0;
    var children = [
      el('div', { class: 'row' }, [
        el('label', { text: textLabel }),
        el('textarea', {
          value: obj[textKey] || '',
          oninput: function (e) { obj[textKey] = e.target.value; touched(false); }
        })
      ]),
      renderImageRow(obj)
    ];

    if (!hideAnswer) {
      children.push(el('div', { class: 'row' }, [
        el('label', { text: '答え（カンマ「,」区切りで複数登録できます。どれか1つに一致で正解）' + (hasExistingHash ? '（' + obj.answerHashes.length + '件設定済み・変更する場合のみ入力）' : '（空欄なら答え合わせ無し）') }),
        el('input', {
          type: 'text', value: obj.answer || '',
          placeholder: hasExistingHash ? '●●●（変更する場合のみ入力）' : '例：さくら,サクラ,桜',
          oninput: function (e) { obj.answer = e.target.value; touched(false); }
        })
      ]));
    }

    return el('div', {}, children);
  }

  /* 画像のアップロード欄（Base64データURIとして settings.json に埋め込む）
   *  → これにより、参加者URLを配った別端末でも画像がそのまま表示される。
   *    （別途リポジトリに画像ファイルを置く必要がない） */
  function renderImageRow(obj) {
    var children = [el('label', { text: '画像（任意・アップロード）' })];

    children.push(el('input', {
      type: 'file',
      accept: 'image/*',
      onchange: function (e) {
        var file = e.target.files[0];
        if (!file) return;
        // 大きすぎる画像は settings.json が重くなるので警告
        if (file.size > 500 * 1024) {
          var sizeKB = Math.round(file.size / 1024);
          if (!confirm(
            '画像サイズが大きめです（' + sizeKB + 'KB）。\n' +
            'settings.json が重くなり、参加者の読み込みが遅くなることがあります。\n' +
            '（推奨：300KB以下）このまま使いますか？'
          )) { e.target.value = ''; return; }
        }
        var reader = new FileReader();
        reader.onload = function () {
          obj.image = reader.result; // data:image/...;base64,xxxx
          touched(true);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
      }
    }));

    if (obj.image) {
      children.push(el('div', { style: 'margin-top:8px;' }, [
        el('img', {
          src: obj.image,
          style: 'max-width:160px;max-height:120px;border-radius:6px;border:1px solid #d7dce6;display:block;margin-bottom:6px;'
        }),
        el('button', {
          class: 'btn btn-danger btn-small', text: '画像を削除',
          onclick: function () { obj.image = ''; touched(true); }
        })
      ]));
    }

    return el('div', { class: 'row' }, children);
  }

  /* 分岐問題の本体：ルール一覧＋デフォルト */
  function renderBranchBody(q) {
    var hideAnswer = q.answerMode === 'nickname';

    var rulesWrap = el('div', {}, []);
    q.rules.forEach(function (rule, ri) {
      rulesWrap.appendChild(renderRule(q, rule, ri, hideAnswer));
    });

    var addRuleBtn = el('button', {
      class: 'btn btn-add btn-small', text: '＋ ルールを追加',
      onclick: function () { q.rules.push(newRule()); touched(true); }
    });

    var defaultBlock = el('div', { class: 'rule-block', style: 'border-style:solid;border-color:#c9ced9;background:#f7f9fc;' }, [
      el('div', { class: 'rule-head' }, [
        el('span', { class: 'rule-no', text: 'どのルールにも当てはまらない人に出す問題（デフォルト）' })
      ]),
      renderVariantFields(q.default, '問題文', 'questionText', hideAnswer)
    ]);

    return el('div', {}, [
      renderAnswerModeRow(q),
      el('p', { class: 'note', text: 'ルールは上から順に判定し、最初に当てはまったものを出題します。' }),
      rulesWrap,
      el('div', { class: 'toolbar', style: 'margin:6px 0 16px;' }, [addRuleBtn]),
      defaultBlock
    ]);
  }

  /* 1ルール（条件群＋出す問題） */
  function renderRule(q, rule, ri, hideAnswer) {
    var condsWrap = el('div', {}, []);
    rule.conditions.forEach(function (cond, ci) {
      condsWrap.appendChild(renderCondition(rule, cond, ci));
    });

    var addCondBtn = el('button', {
      class: 'btn btn-add btn-small', text: '＋ 条件を追加（AND）',
      onclick: function () { rule.conditions.push(newCondition()); touched(true); }
    });

    var preview = el('div', { class: 'preview-box' }, [previewText(rule)]);

    var head = el('div', { class: 'rule-head' }, [
      el('span', { class: 'rule-no', text: 'ルール ' + (ri + 1) + '（優先順位 ' + (ri + 1) + '）' }),
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn btn-ghost btn-small', text: '▲', onclick: function () { moveRule(q, ri, -1); } }),
        el('button', { class: 'btn btn-ghost btn-small', text: '▼', onclick: function () { moveRule(q, ri, 1); } }),
        el('button', {
          class: 'btn btn-danger btn-small', text: '削除',
          onclick: function () { q.rules.splice(ri, 1); touched(true); }
        })
      ])
    ]);

    var labelRow = el('div', { class: 'row' }, [
      el('label', { text: 'ルール名（メモ用・任意）' }),
      el('input', {
        type: 'text', value: rule.label || '', placeholder: '例：4文字の人',
        oninput: function (e) { rule.label = e.target.value; touched(false); }
      })
    ]);

    return el('div', { class: 'rule-block' }, [
      head,
      labelRow,
      el('label', { class: 'note', text: '条件（すべて満たした人が対象）' }),
      condsWrap,
      el('div', { class: 'toolbar', style: 'margin:4px 0 4px;' }, [addCondBtn]),
      preview,
      el('div', { style: 'margin-top:10px;' }, [renderVariantFields(rule, '出す問題文', 'questionText', hideAnswer)])
    ]);
  }

  /* 1条件の行 */
  function renderCondition(rule, cond, ci) {
    var kindSelect = el('select', {
      onchange: function (e) { cond.kind = e.target.value; touched(true); }
    }, [
      option('length', '文字数', cond.kind),
      option('charAt', 'N文字目が', cond.kind),
      option('startsWith', '前方一致（で始まる）', cond.kind),
      option('endsWith', '後方一致（で終わる）', cond.kind),
      option('contains', '含む', cond.kind),
      option('equals', '完全一致', cond.kind)
    ]);

    var params = [];

    if (cond.kind === 'length') {
      var opSelect = el('select', {
        onchange: function (e) { cond.op = e.target.value; touched(true); }
      }, [
        option('eq', '＝', cond.op),
        option('gte', '以上', cond.op),
        option('lte', '以下', cond.op),
        option('gt', 'より多い', cond.op),
        option('lt', '未満', cond.op),
        option('odd', '奇数', cond.op),
        option('even', '偶数', cond.op)
      ]);
      params.push(opSelect);
      if (cond.op !== 'odd' && cond.op !== 'even') {
        params.push(el('input', {
          class: 'cond-num', type: 'number', min: '0', value: cond.value || '',
          placeholder: '数', oninput: function (e) { cond.value = e.target.value; touched(false); }
        }));
        params.push(el('span', { text: '文字' }));
      }
    } else if (cond.kind === 'charAt') {
      params.push(el('input', {
        class: 'cond-num', type: 'number', min: '1', value: cond.pos || '1',
        oninput: function (e) { cond.pos = e.target.value; touched(false); }
      }));
      params.push(el('span', { text: '文字目が' }));
      params.push(el('input', {
        class: 'cond-char', type: 'text', maxlength: '2', value: cond.value || '',
        placeholder: '字', oninput: function (e) { cond.value = e.target.value; touched(false); }
      }));
    } else {
      params.push(el('input', {
        class: 'cond-str', type: 'text', value: cond.value || '',
        placeholder: '文字列', oninput: function (e) { cond.value = e.target.value; touched(false); }
      }));
    }

    // 「ではない（条件を反転）」チェックボックス
    var notCb = el('input', {
      type: 'checkbox',
      onchange: function (e) { cond.not = e.target.checked; touched(true); }
    });
    notCb.checked = !!cond.not;
    var notLabel = el('label', {
      style: 'display:inline-flex;align-items:center;gap:3px;font-weight:600;color:#b9651f;cursor:pointer;white-space:nowrap;'
    }, [notCb, document.createTextNode('ではない')]);

    var removeBtn = el('button', {
      class: 'btn btn-danger btn-small', text: '×',
      onclick: function () { rule.conditions.splice(ci, 1); touched(true); }
    });

    return el('div', { class: 'cond-row' }, [kindSelect].concat(params, [notLabel, removeBtn]));
  }

  function option(val, label, current) {
    var o = el('option', { value: val, text: label });
    if (val === current) o.selected = true;
    return o;
  }

  /* ルールのプレビュー文 */
  function previewText(rule) {
    var conds = (rule.conditions || []).map(function (c) {
      return describeCondition(serializeForPreview(c)); // common.js
    });
    if (conds.length === 0) return '条件が未設定です（このルールは無視されます）';
    return 'ニックネームが【' + conds.join(' かつ ') + '】の人に出題';
  }

  /* プレビュー用に値を数値化など整形 */
  function serializeForPreview(c) {
    if (c.kind === 'length') return { kind: 'length', op: c.op, value: c.value || '?', not: c.not };
    if (c.kind === 'charAt') return { kind: 'charAt', pos: c.pos || '?', value: c.value || '?', not: c.not };
    return { kind: c.kind, value: c.value || '?', not: c.not };
  }

  /* ----- 並べ替え -------------------------------------------------------- */
  function moveQuestion(qi, dir) {
    var ni = qi + dir;
    if (ni < 0 || ni >= draft.questions.length) return;
    var tmp = draft.questions[qi];
    draft.questions[qi] = draft.questions[ni];
    draft.questions[ni] = tmp;
    touched(true);
  }
  function moveRule(q, ri, dir) {
    var ni = ri + dir;
    if (ni < 0 || ni >= q.rules.length) return;
    var tmp = q.rules[ri];
    q.rules[ri] = q.rules[ni];
    q.rules[ni] = tmp;
    touched(true);
  }

  /* =======================================================================
   * 書き出し（settings.json 生成）
   * ===================================================================== */
  async function resolveHashes(obj) {
    // 平文の答えがあれば（カンマ区切りで複数）ハッシュ化、
    // なければ既存ハッシュ配列を維持、どちらも無ければ []（答え合わせ無し）
    if (obj.answer && obj.answer.trim() !== '') {
      var parts = obj.answer.split(',')
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s !== ''; });
      var hashes = [];
      for (var i = 0; i < parts.length; i++) {
        var h = await hashAnswer(parts[i]);
        if (hashes.indexOf(h) === -1) hashes.push(h); // 重複は除く
      }
      return hashes;
    }
    return (obj.answerHashes && obj.answerHashes.length) ? obj.answerHashes : [];
  }

  function serializeCondition(c) {
    var out;
    if (c.kind === 'length') {
      if (c.op === 'odd' || c.op === 'even') out = { kind: 'length', op: c.op, value: 0 };
      else if (c.value === '' || c.value == null) return null;
      else out = { kind: 'length', op: c.op, value: Number(c.value) };
    } else if (c.kind === 'charAt') {
      if (!c.value) return null;
      out = { kind: 'charAt', pos: Number(c.pos) || 1, value: c.value };
    } else {
      if (!c.value) return null;
      out = { kind: c.kind, value: c.value };
    }
    if (c.not) out.not = true;
    return out;
  }

  async function buildSettings() {
    var rule = draft.nicknameRule || {};
    var out = {
      version: 1,
      title: draft.title || '謎解きクイズ',
      description: draft.description || '',
      nicknameRule: {
        minLength: Number(rule.minLength) || 0,
        maxLength: Number(rule.maxLength) || 0,
        allowedTypes: rule.allowedTypes || [],
        askSuffix: !!rule.askSuffix
      },
      questions: []
    };

    for (var i = 0; i < draft.questions.length; i++) {
      var q = draft.questions[i];
      var mode = q.answerMode === 'nickname' ? 'nickname' : 'fixed';
      var useNick = mode === 'nickname';
      if (q.type === 'branch') {
        var rules = [];
        for (var r = 0; r < q.rules.length; r++) {
          var rule = q.rules[r];
          var conds = rule.conditions.map(serializeCondition).filter(Boolean);
          rules.push({
            label: rule.label || '',
            conditions: conds,
            questionText: rule.questionText || '',
            image: rule.image || '',
            // ニックネームモードのときは答えを事前に持たない（実行時にニックネームと照合）
            answerHashes: useNick ? [] : await resolveHashes(rule)
          });
        }
        out.questions.push({
          type: 'branch',
          answerMode: mode,
          rules: rules,
          default: {
            questionText: q.default.questionText || '',
            image: q.default.image || '',
            answerHashes: useNick ? [] : await resolveHashes(q.default)
          }
        });
      } else {
        out.questions.push({
          type: 'fixed',
          answerMode: mode,
          text: q.text || '',
          image: q.image || '',
          answerHashes: useNick ? [] : await resolveHashes(q)
        });
      }
    }
    return out;
  }

  async function exportSettings() {
    if (draft.questions.length === 0) {
      showStatus('問題が1つもありません。', false);
      return;
    }
    try {
      var data = await buildSettings();
      var json = JSON.stringify(data, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: 'settings.json' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus('settings.json を書き出しました。GitHubのリポジトリに置き換えてください。', true);
    } catch (e) {
      showStatus('書き出しに失敗しました：' + e.message, false);
    }
  }

  /* =======================================================================
   * 読み込み（settings.json → 編集データ）
   * ===================================================================== */
  /* 答えハッシュ配列を取り込む（新形式 answerHashes / 旧形式 answerHash 両対応） */
  function importHashes(obj) {
    if (obj.answerHashes && obj.answerHashes.length) return obj.answerHashes.slice();
    if (obj.answerHash) return [obj.answerHash];
    return [];
  }

  function importCondition(c) {
    return {
      kind: c.kind,
      op: c.op || 'eq',
      value: c.value !== undefined ? String(c.value) : '',
      pos: c.pos !== undefined ? String(c.pos) : '1',
      not: !!c.not
    };
  }

  function importSettings(data) {
    draft.title = data.title || '';
    draft.description = data.description || '';
    var nr = data.nicknameRule || {};
    draft.nicknameRule = {
      minLength: nr.minLength ? String(nr.minLength) : '',
      maxLength: nr.maxLength ? String(nr.maxLength) : '',
      allowedTypes: nr.allowedTypes || [],
      askSuffix: !!nr.askSuffix
    };
    draft.questions = (data.questions || []).map(function (q) {
      if (q.type === 'branch') {
        return {
          type: 'branch',
          answerMode: q.answerMode === 'nickname' ? 'nickname' : 'fixed',
          rules: (q.rules || []).map(function (r) {
            return {
              label: r.label || '',
              conditions: (r.conditions || []).map(importCondition),
              questionText: r.questionText || '',
              image: r.image || '',
              answer: '',
              answerHashes: importHashes(r)
            };
          }),
          default: {
            questionText: (q.default && q.default.questionText) || '',
            image: (q.default && q.default.image) || '',
            answer: '',
            answerHashes: importHashes(q.default || {})
          }
        };
      }
      return {
        type: 'fixed',
        answerMode: q.answerMode === 'nickname' ? 'nickname' : 'fixed',
        text: q.text || '',
        image: q.image || '',
        answer: '',
        answerHashes: importHashes(q)
      };
    });
  }

  /* ----- ステータス表示 -------------------------------------------------- */
  function showStatus(message, ok) {
    statusBox.textContent = message;
    statusBox.className = 'status-msg ' + (ok ? 'status-ok' : 'status-ng');
    statusBox.classList.remove('hidden');
  }

  /* =======================================================================
   * イベント登録
   * ===================================================================== */
  titleInput.addEventListener('input', function (e) { draft.title = e.target.value; saveDraft(); });
  descInput.addEventListener('input', function (e) { draft.description = e.target.value; saveDraft(); });

  // ニックネーム登録ルール
  nickMinInput.addEventListener('input', function (e) { draft.nicknameRule.minLength = e.target.value; saveDraft(); });
  nickMaxInput.addEventListener('input', function (e) { draft.nicknameRule.maxLength = e.target.value; saveDraft(); });
  nickTypeBoxes.forEach(function (cb) {
    cb.addEventListener('change', function () {
      draft.nicknameRule.allowedTypes = nickTypeBoxes
        .filter(function (b) { return b.checked; })
        .map(function (b) { return b.getAttribute('data-type'); });
      saveDraft();
    });
  });
  nickAskSuffix.addEventListener('change', function (e) {
    draft.nicknameRule.askSuffix = e.target.checked;
    saveDraft();
  });

  document.getElementById('btn-expand-all').addEventListener('click', function () {
    draft.questions.forEach(function (q) { q._open = true; });
    touched(true);
  });
  document.getElementById('btn-collapse-all').addEventListener('click', function () {
    draft.questions.forEach(function (q) { q._open = false; });
    touched(true);
  });

  document.getElementById('btn-add-fixed').addEventListener('click', function () {
    draft.questions.push(newFixed()); touched(true);
  });
  document.getElementById('btn-add-branch').addEventListener('click', function () {
    draft.questions.push(newBranch()); touched(true);
  });

  document.getElementById('btn-export').addEventListener('click', exportSettings);

  document.getElementById('btn-import').addEventListener('click', function () {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        importSettings(data);
        saveDraft();
        render();
        showStatus('settings.json を読み込みました。（答えは伏せて表示しています）', true);
      } catch (err) {
        showStatus('読み込みに失敗しました：JSONとして解釈できません。', false);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = ''; // 同じファイルを連続で読めるようにリセット
  });

  document.getElementById('btn-clear-draft').addEventListener('click', function () {
    if (!confirm('編集中の下書きをすべて消します。よろしいですか？')) return;
    draft.title = '';
    draft.description = '';
    draft.nicknameRule = { minLength: '', maxLength: '', allowedTypes: [], askSuffix: false };
    draft.questions = [];
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    render();
    showStatus('下書きをクリアしました。', true);
  });

  /* ----- 起動 ------------------------------------------------------------ */
  loadDraft();
  render();
})();
