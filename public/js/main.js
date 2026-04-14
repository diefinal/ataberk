// Video thumbnail - ilk frame'i göster
document.querySelectorAll('.video-thumb video').forEach(video => {
  video.currentTime = 1;
});
