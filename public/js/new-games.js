(() => {
  const root = document.querySelector("[data-new-game]");
  if (!root) return;
  const kind = root.dataset.newGame,
    status = document.getElementById("new-status"),
    score = document.getElementById("new-score"),
    reset = document.getElementById("new-game");
  if (kind === "connectfour") {
    const boardEl = document.getElementById("connect-board");
    let board, player, over;
    function draw() {
      boardEl.replaceChildren();
      for (let y = 0; y < 6; y++)
        for (let x = 0; x < 7; x++) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "connect-cell player-" + board[y][x];
          b.setAttribute(
            "aria-label",
            `${x + 1}. sütun, ${y + 1}. sıra${board[y][x] ? ", dolu" : ""}`,
          );
          b.dataset.column = x;
          b.disabled = over;
          b.addEventListener("click", () => play(x));
          boardEl.append(b);
        }
    }
    function win(y, x) {
      for (const [dy, dx] of [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
      ]) {
        let n = 1;
        for (const sign of [-1, 1]) {
          let yy = y + dy * sign,
            xx = x + dx * sign;
          while (
            yy >= 0 &&
            yy < 6 &&
            xx >= 0 &&
            xx < 7 &&
            board[yy][xx] === player
          ) {
            n++;
            yy += dy * sign;
            xx += dx * sign;
          }
        }
        if (n >= 4) return true;
      }
      return false;
    }
    function play(x) {
      if (over) return;
      let y = 5;
      while (y >= 0 && board[y][x]) y--;
      if (y < 0) {
        status.textContent = "Bu sütun dolu, başka bir sütun seç.";
        return;
      }
      board[y][x] = player;
      if (win(y, x)) {
        over = true;
        status.textContent = (player === 1 ? "Mercan" : "Mavi") + " kazandı!";
        score.textContent = "4 bir arada";
      } else if (board.every((r) => r.every(Boolean))) {
        over = true;
        status.textContent = "Berabere! Bir oyun daha?";
      } else {
        player = 3 - player;
        status.textContent = "Sıra: " + (player === 1 ? "Mercan" : "Mavi");
      }
      draw();
    }
    function start() {
      board = Array.from({ length: 6 }, () => Array(7).fill(0));
      player = 1;
      over = false;
      status.textContent = "Sıra: Mercan";
      score.textContent = "İki kişilik";
      draw();
    }
    reset.addEventListener("click", start);
    start();
  }
  if (kind === "starcatcher") {
    const area = document.getElementById("star-board");
    let target = -1,
      n = 0,
      remaining = 20,
      timer,
      playing = false;
    function move() {
      const old = target;
      do {
        target = Math.floor(Math.random() * 9);
      } while (target === old);
      [...area.children].forEach((b, i) => {
        b.textContent = i === target ? "★" : "·";
        b.dataset.target = String(i === target);
        b.setAttribute(
          "aria-label",
          i === target ? "Yıldızı yakala" : `${i + 1}. boş alan`,
        );
      });
    }
    for (let i = 0; i < 9; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "·";
      b.setAttribute("aria-label", `${i + 1}. alan`);
      b.addEventListener("click", () => {
        if (!playing || i !== target) return;
        n++;
        score.textContent = n + " yıldız";
        move();
      });
      area.append(b);
    }
    reset.textContent = "Başlat";
    status.textContent = "20 saniyelik yıldız avına hazır mısın?";
    reset.addEventListener("click", () => {
      clearInterval(timer);
      n = 0;
      remaining = 20;
      playing = true;
      score.textContent = "0 yıldız";
      status.textContent = "Kalan süre: 20 saniye";
      move();
      timer = setInterval(() => {
        remaining--;
        status.textContent = "Kalan süre: " + remaining + " saniye";
        if (remaining <= 0) {
          clearInterval(timer);
          playing = false;
          status.textContent = `Harika! ${n} yıldız yakaladın.`;
          reset.textContent = "Tekrar oyna";
        }
      }, 1000);
    });
    window.addEventListener("pagehide", () => clearInterval(timer));
  }
  if (kind === "wordgarden") {
    const words = [
        { word: "AİLE", clue: "Birlikte hikâyemizi yazdığımız insanlar." },
        { word: "SEVGİ", clue: "Paylaştıkça büyüyen bir duygu." },
        { word: "BAHÇE", clue: "Çiçekler ve küçük keşiflerle dolu bir yer." },
        { word: "GÜNEŞ", clue: "Gündüz gökyüzünü aydınlatır." },
        { word: "MASAL", clue: "Bir varmış, bir yokmuş…" },
      ],
      tiles = document.getElementById("word-tiles"),
      input = document.getElementById("word-answer");
    let index = 0,
      solved = new Set();
    function render() {
      input.value = "";
      tiles.replaceChildren();
      const letters = [...words[index].word].sort(() => Math.random() - 0.5);
      letters.forEach((letter) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = letter;
        b.addEventListener("click", () => {
          input.value += letter;
          input.focus();
        });
        tiles.append(b);
      });
      status.textContent = words[index].clue;
      score.textContent = solved.size + " / " + words.length;
    }
    function check() {
      if (input.value.trim().toLocaleUpperCase("tr-TR") === words[index].word) {
        solved.add(index);
        status.textContent =
          solved.size === words.length
            ? "Bütün kelimeleri buldun! Harika!"
            : "Doğru! Yeni bir kelime seni bekliyor.";
        score.textContent = solved.size + " / " + words.length;
      } else status.textContent = "Bir daha dene. İpucu: " + words[index].clue;
    }
    document.getElementById("check-word").addEventListener("click", check);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") check();
    });
    document.getElementById("next-word").addEventListener("click", () => {
      index = (index + 1) % words.length;
      render();
    });
    reset.addEventListener("click", () => {
      index = 0;
      solved = new Set();
      render();
    });
    render();
  }
})();
