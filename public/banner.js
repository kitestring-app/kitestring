const button = document.getElementById('open');
button.textContent = new URLSearchParams(location.search).get('kind') === 'break-over'
  ? 'Back to focus · click to open' : 'Break time · click to open';
button.addEventListener('click', () => window.banner?.open());
