// Lightbox
(function() {
  const overlay = document.createElement('div');
  overlay.id = 'lightbox';
  overlay.innerHTML = `
    <div class="lb-backdrop"></div>
    <button class="lb-close">✕</button>
    <button class="lb-prev">‹</button>
    <button class="lb-next">›</button>
    <div class="lb-content">
      <img class="lb-img" src="" alt="">
      <div class="lb-caption"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const lb = {
    el: overlay,
    img: overlay.querySelector('.lb-img'),
    caption: overlay.querySelector('.lb-caption'),
    images: [],
    current: 0,

    open(index) {
      this.current = index;
      this.show();
      this.el.classList.add('active');
      document.body.style.overflow = 'hidden';
    },

    close() {
      this.el.classList.remove('active');
      document.body.style.overflow = '';
    },

    show() {
      const item = this.images[this.current];
      this.img.src = item.src;
      this.img.alt = item.alt;
      this.caption.textContent = item.alt;
      overlay.querySelector('.lb-prev').style.display = this.images.length > 1 ? 'flex' : 'none';
      overlay.querySelector('.lb-next').style.display = this.images.length > 1 ? 'flex' : 'none';
    },

    prev() {
      this.current = (this.current - 1 + this.images.length) % this.images.length;
      this.img.style.animation = 'none';
      this.img.offsetHeight;
      this.img.style.animation = 'lbSlideIn 0.25s ease';
      this.show();
    },

    next() {
      this.current = (this.current + 1) % this.images.length;
      this.img.style.animation = 'none';
      this.img.offsetHeight;
      this.img.style.animation = 'lbSlideIn 0.25s ease';
      this.show();
    }
  };

  // Tüm resimleri topla
  function init() {
    const imgs = document.querySelectorAll('.lb-trigger');
    lb.images = Array.from(imgs).map(el => ({
      src: el.dataset.src || el.src || el.querySelector('img')?.src,
      alt: el.dataset.caption || el.alt || el.querySelector('img')?.alt || ''
    }));

    imgs.forEach((el, i) => {
      el.style.cursor = 'zoom-in';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        lb.open(i);
      });
    });
  }

  overlay.querySelector('.lb-close').addEventListener('click', () => lb.close());
  overlay.querySelector('.lb-backdrop').addEventListener('click', () => lb.close());
  overlay.querySelector('.lb-prev').addEventListener('click', () => lb.prev());
  overlay.querySelector('.lb-next').addEventListener('click', () => lb.next());

  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('active')) return;
    if (e.key === 'Escape') lb.close();
    if (e.key === 'ArrowLeft') lb.prev();
    if (e.key === 'ArrowRight') lb.next();
  });

  // Touch/swipe desteği
  let touchStartX = 0;
  overlay.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; });
  overlay.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) diff > 0 ? lb.next() : lb.prev();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
