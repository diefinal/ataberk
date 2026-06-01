const express = require('express');
const router = express.Router();

const GAMES = [
  { id: 'snake', name: 'Snake', icon: '🐍', desc: 'Klasik yılan oyunu' },
  { id: '2048', name: '2048', icon: '🧩', desc: 'Sayıları birleştir' },
  { id: 'tictactoe', name: 'Tic-Tac-Toe', icon: '❌', desc: 'İki kişilik X-O oyunu' },
  { id: 'tetris', name: 'Tetris', icon: '🎮', desc: 'Klasik Tetris' },
  { id: 'memory', name: 'Hafıza', icon: '🃏', desc: 'Kartları eşleştir' },
];

router.get('/', (req, res) => {
  res.render('games/index', { games: GAMES, session: req.session });
});

router.get('/:id', (req, res) => {
  const game = GAMES.find(g => g.id === req.params.id);
  if (!game) return res.redirect('/oyunlar');
  res.render(`games/${game.id}`, { game, session: req.session });
});

module.exports = router;
