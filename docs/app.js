(() => {
  "use strict";

  const header = document.getElementById("siteHeader");
  const onScroll = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const screenTabs = Array.from(document.querySelectorAll(".screen-tab"));
  const shots = Array.from(document.querySelectorAll(".screen-shot"));
  const screenView = document.getElementById("screenView");
  const screenTitle = document.getElementById("screenTitle");
  const screenDesc = document.getElementById("screenDesc");
  const screenPath = document.getElementById("screenPath");
  const screenCount = document.getElementById("screenCount");

  const selectScreen = (index) => {
    screenTabs.forEach((tab, i) => {
      const active = i === index;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    shots.forEach((shot, i) => shot.classList.toggle("is-active", i === index));

    const tab = screenTabs[index];
    if (!tab) return;
    if (screenTitle) screenTitle.textContent = tab.dataset.title || "";
    if (screenDesc) screenDesc.textContent = tab.dataset.desc || "";
    if (screenPath) screenPath.textContent = `screenshots/${tab.dataset.slug}.jpg`;
    if (screenCount) screenCount.textContent = `${String(index + 1).padStart(2, "0")} / ${String(screenTabs.length).padStart(2, "0")}`;
    if (screenView) screenView.setAttribute("aria-labelledby", tab.id);
  };

  screenTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectScreen(index));
    tab.addEventListener("keydown", (event) => {
      const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % screenTabs.length;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + screenTabs.length) % screenTabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = screenTabs.length - 1;
      screenTabs[next].focus();
      selectScreen(next);
    });
  });

  const osTabs = Array.from(document.querySelectorAll(".os-tab"));
  const osPanels = Array.from(document.querySelectorAll(".os-panel"));

  const selectOs = (index) => {
    osTabs.forEach((tab, i) => {
      const active = i === index;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    osPanels.forEach((panel, i) => {
      const active = i === index;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
  };

  osTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectOs(index));
    tab.addEventListener("keydown", (event) => {
      const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % osTabs.length;
      if (event.key === "ArrowLeft") next = (index - 1 + osTabs.length) % osTabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = osTabs.length - 1;
      osTabs[next].focus();
      selectOs(next);
    });
  });

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
      return ok;
    }
  };

  document.querySelectorAll(".copy-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.copy || "";
      const ok = await copyText(value);
      const previous = button.textContent;
      button.textContent = ok ? "Copied" : "Failed";
      window.setTimeout(() => {
        button.textContent = previous;
      }, 1400);
    });
  });

  const reveals = Array.from(document.querySelectorAll(".reveal"));
  if ("IntersectionObserver" in window && reveals.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    reveals.forEach((element) => observer.observe(element));
  } else {
    reveals.forEach((element) => element.classList.add("is-visible"));
  }
})();
