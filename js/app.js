/* =========================================================================
 * app.js  ―  参加者ページのロジック
 *  流れ: settings.json読み込み → ニックネーム登録 → 複数問を順に出題
 *        （その中の分岐問はニックネームの条件で出し分け）→ クリア
 * ========================================================================= */

(function () {
  'use strict';

  // 画面要素
  var screens = {
    error:    document.getElementById('screen-error'),
    start:    document.getElementById('screen-start'),
    question: document.getElementById('screen-question'),
    clear:    document.getElementById('screen-clear')
  };

  var els = {
    errorMessage:   document.getElementById('error-message'),
    appTitle:       document.getElementById('app-title'),
    appDescription: document.getElementById('app-description'),
    nicknameInput:  document.getElementById('nickname-input'),
    nicknameRule:   document.getElementById('nickname-rule'),
    nicknameError:  document.getElementById('nickname-error'),
    suffixArea:     document.getElementById('suffix-area'),
    suffixOptions:  document.getElementById('suffix-options'),
    suffixError:    document.getElementById('suffix-error'),
    startButton:    document.getElementById('start-button'),
    qCurrent:       document.getElementById('q-current'),
    qTotal:         document.getElementById('q-total'),
    qText:          document.getElementById('q-text'),
    qImages:        document.getElementById('q-images'),
    answerArea:     document.getElementById('answer-area'),
    answerInput:    document.getElementById('answer-input'),
    answerFeedback: document.getElementById('answer-feedback'),
    answerButton:   document.getElementById('answer-button'),
    nextButton:     document.getElementById('next-button'),
    clearMessage:   document.getElementById('clear-message'),
    restartButton:  document.getElementById('restart-button')
  };

  // 状態
  var settings = null;     // settings.json の中身
  var nickname = '';       // 入力されたニックネーム
  var displayName = '';    // ニックネーム＋呼び方（例: たろうくん）
  var askSuffix = false;   // 呼び方の選択を求めるか
  var suffix = '';         // 選ばれた呼び方（くん/ちゃん/さん/''＝呼び捨て）
  var suffixChosen = false;// 呼び方を選んだか
  var resolvedList = [];   // ニックネームに応じて確定した「出題内容」の配列
  var index = 0;           // 今何問目か（0始まり）

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle('hidden', key !== name);
    });
  }

  /* --- 起動 --------------------------------------------------------------- */
  init();

  async function init() {
    try {
      settings = await loadSettings('settings.json');
    } catch (e) {
      els.errorMessage.textContent = e.message;
      showScreen('error');
      return;
    }

    els.appTitle.textContent = settings.title || '謎解きクイズ';
    document.title = settings.title || '謎解きクイズ';
    if (settings.description) {
      els.appDescription.textContent = settings.description;
    }
    // ニックネーム登録ルールの案内を表示
    var ruleHint = describeNicknameRule(settings.nicknameRule); // common.js
    if (ruleHint) {
      els.nicknameRule.textContent = ruleHint;
      els.nicknameRule.classList.remove('hidden');
    }

    // 呼び方の選択（くん/ちゃん/さん/呼び捨て）
    askSuffix = !!(settings.nicknameRule && settings.nicknameRule.askSuffix);
    if (askSuffix) {
      els.suffixArea.classList.remove('hidden');
    }

    showScreen('start');
    els.nicknameInput.focus();
  }

  /* 呼び方ボタンの選択 */
  if (els.suffixOptions) {
    els.suffixOptions.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.suffix-btn') : null;
      if (!btn) return;
      suffix = btn.getAttribute('data-suffix') || '';
      suffixChosen = true;
      els.suffixError.classList.add('hidden');
      // 選択状態の見た目を更新
      var all = els.suffixOptions.querySelectorAll('.suffix-btn');
      Array.prototype.forEach.call(all, function (b) {
        b.classList.toggle('selected', b === btn);
      });
    });
  }

  /* --- ニックネーム登録 → スタート --------------------------------------- */
  els.startButton.addEventListener('click', start);
  els.nicknameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') start();
  });

  function start() {
    var value = els.nicknameInput.value.trim();
    // 登録ルールを満たすかチェック。満たさなければはじいて再入力を促す
    var check = validateNickname(value, settings.nicknameRule); // common.js
    if (!check.ok) {
      els.nicknameError.textContent = check.message;
      els.nicknameError.classList.remove('hidden');
      els.nicknameInput.focus();
      return;
    }
    els.nicknameError.classList.add('hidden');

    // 呼び方が必要なのに未選択ならはじく
    if (askSuffix && !suffixChosen) {
      els.suffixError.classList.remove('hidden');
      return;
    }
    els.suffixError.classList.add('hidden');

    nickname = value;
    displayName = nickname + (askSuffix ? suffix : '');

    // ニックネームに応じて、全問題の「出題内容」をここで確定させる
    resolvedList = (settings.questions || []).map(function (q) {
      return resolveQuestion(q, nickname);
    });

    index = 0;
    showScreen('question');
    renderQuestion();
  }

  /* 答えハッシュの配列を取り出す（新形式 answerHashes / 旧形式 answerHash の両対応） */
  function getAnswerHashes(obj) {
    if (obj.answerHashes && obj.answerHashes.length) return obj.answerHashes;
    if (obj.answerHash) return [obj.answerHash];
    return [];
  }

  /* 画像の配列を取り出す（新形式 images / 旧形式 image の両対応） */
  function getImages(obj) {
    if (obj.images && obj.images.length) return obj.images;
    if (obj.image) return [obj.image];
    return [];
  }

  /* 1問分の出題内容を確定する（分岐問はニックネームで出し分け） */
  function resolveQuestion(q, nick) {
    var mode = q.answerMode === 'nickname' ? 'nickname' : 'fixed';
    if (q.type === 'branch') {
      var picked = resolveBranch(nick, q); // common.js
      if (!picked) {
        // ルールにもデフォルトにも該当しない場合の保険
        return { questionText: '(この問題は準備中です)', answerHashes: [], images: [], answerMode: mode };
      }
      return {
        questionText: picked.questionText || '',
        images: getImages(picked),
        answerHashes: getAnswerHashes(picked),
        answerMode: mode
      };
    }
    // 通常問題（全員共通）
    return {
      questionText: q.text || '',
      images: getImages(q),
      answerHashes: getAnswerHashes(q),
      answerMode: mode
    };
  }

  /* --- 問題の描画 -------------------------------------------------------- */
  function renderQuestion() {
    var item = resolvedList[index];

    els.qCurrent.textContent = String(index + 1);
    els.qTotal.textContent = String(resolvedList.length);
    // 差し込みタグ（{1文字目}・{呼び名} 等）をニックネームの内容に置き換える
    els.qText.textContent = applyNicknameTemplate(item.questionText, nickname, displayName);

    // 画像（複数枚）を表示
    els.qImages.innerHTML = '';
    item.images.forEach(function (src) {
      var img = document.createElement('img');
      img.src = src;
      img.className = 'question-image';
      img.alt = '問題画像';
      els.qImages.appendChild(img);
    });

    // フィードバック・入力欄リセット
    els.answerFeedback.classList.add('hidden');
    els.answerFeedback.textContent = '';
    els.answerInput.value = '';

    var hasAnswer = item.answerMode === 'nickname' || item.answerHashes.length > 0;
    // 答えがある問題 → 入力欄＋こたえるボタン
    // 答えが無い問題 → つぎへボタンのみ（読み物・誘導用）
    els.answerArea.classList.toggle('hidden', !hasAnswer);
    els.nextButton.classList.toggle('hidden', hasAnswer);

    if (hasAnswer) {
      els.answerInput.focus();
    }
  }

  /* --- 答え合わせ -------------------------------------------------------- */
  els.answerButton.addEventListener('click', checkAnswer);
  els.answerInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') checkAnswer();
  });
  els.nextButton.addEventListener('click', goNext);

  async function checkAnswer() {
    var item = resolvedList[index];
    var value = els.answerInput.value.trim();
    if (value === '') return;

    var correct;
    if (item.answerMode === 'nickname') {
      // 答え＝参加者が登録したニックネーム（同じ正規化ルールで照合）
      correct = normalizeAnswer(value) === normalizeAnswer(nickname); // common.js
    } else {
      var inputHash = await hashAnswer(value); // common.js（正規化込み）
      // 登録された複数の想定解のどれか1つに一致すれば正解
      correct = item.answerHashes.indexOf(inputHash) !== -1;
    }

    if (correct) {
      showFeedback('正解です！', true);
      // 少し見せてから次へ
      setTimeout(goNext, 800);
    } else {
      showFeedback('ちがうみたい…もう一度！', false);
    }
  }

  function showFeedback(message, isCorrect) {
    els.answerFeedback.textContent = message;
    els.answerFeedback.classList.remove('hidden', 'feedback-ok', 'feedback-ng');
    els.answerFeedback.classList.add(isCorrect ? 'feedback-ok' : 'feedback-ng');
  }

  function goNext() {
    index++;
    if (index >= resolvedList.length) {
      finish();
    } else {
      renderQuestion();
    }
  }

  /* --- クリア ------------------------------------------------------------ */
  function finish() {
    els.clearMessage.textContent =
      displayName + '、すべての問題をクリアしました！';
    showScreen('clear');
  }

  els.restartButton.addEventListener('click', function () {
    els.nicknameInput.value = '';
    // 呼び方の選択をリセット
    suffix = '';
    suffixChosen = false;
    if (els.suffixOptions) {
      var all = els.suffixOptions.querySelectorAll('.suffix-btn');
      Array.prototype.forEach.call(all, function (b) { b.classList.remove('selected'); });
    }
    showScreen('start');
    els.nicknameInput.focus();
  });
})();
