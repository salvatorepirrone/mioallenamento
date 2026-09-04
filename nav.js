(function () {
  function setOpen(open) {
    document.body.classList.toggle('nav-open', open);
  }

  var toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      setOpen(!document.body.classList.contains('nav-open'));
    });
  }

  var backdrop = document.querySelector('.nav-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', function () { setOpen(false); });
  }

  document.querySelectorAll('.nav-links a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (window.innerWidth < 900) setOpen(false);
    });
  });
})();
