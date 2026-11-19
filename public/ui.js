// 3Dビューの初期化に失敗しても、パネルは開けるようにする。
const $ = (selector) => document.querySelector(selector);

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('#panel section').forEach((s) => s.classList.toggle('on', s.dataset.pane === name));
}
$('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('button[data-tab]');
  if (tab) showTab(tab.dataset.tab);
});
$('#panel-toggle').addEventListener('click', () => $('#panel').classList.toggle('open'));

import('./main.js').catch((error) => {
  console.error('Could not start the simulator', error);
  $('#st-dot').className = 'dot bad';
  $('#st-text').textContent = 'Could not start the simulator. See the browser console for details.';
});
