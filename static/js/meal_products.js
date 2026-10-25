(() => {
  "use strict";
  const picker = document.querySelector("#picker");
  if (!picker) return;
  const form = picker.querySelector("form");
  const categoryInputs = [...picker.querySelectorAll('input[name="meal_code"]')];
  const categoryStep = picker.querySelector("[data-category-step]");
  const dishInput = picker.querySelector("#picker-dish-code");
  const productPanel = picker.querySelector("[data-product-picker]");
  const productGrid = picker.querySelector("[data-product-grid]");
  const productStatus = picker.querySelector("[data-product-status]");
  const passengerNoteBox = picker.querySelector(".passenger-note-box");
  const catalogNode = picker.querySelector("#pw-dish-catalog");
  const footnote = picker.querySelector("[data-picker-footnote]");
  const continueButton = picker.querySelector("[data-continue-to-dishes]");
  const backButton = picker.querySelector("[data-back-to-categories]");
  const saveButton = picker.querySelector("[data-save-meal]");
  const pickerContent = picker.querySelector("[data-picker-content]");
  let catalog = {};
  let currentCategory = "";
  let originalCategory = "";
  let originalDish = "";
  let chosenPax = "";
  let selectedDish = "";
  let pickerStep = 1;
  let dishNames = {};
  try { catalog = JSON.parse(catalogNode?.textContent || "{}"); } catch (_) { catalog = {}; }

  const productTranslations = {
    hi: {'STEP 2 · SPECIFIC DISH':'चरण 2 · विशिष्ट व्यंजन','Choose the dish you want':'अपना पसंदीदा व्यंजन चुनें','The crew dashboard and any late-change request will use this exact dish, not just the meal category.':'क्रू डैशबोर्ड और देर से किए गए बदलाव में भोजन की श्रेणी के बजाय यही व्यंजन दिखेगा।','Choose a meal category first, then select one dish.':'पहले भोजन की श्रेणी चुनें, फिर एक व्यंजन चुनें।','Choose one dish below. This exact choice is sent to the crew.':'नीचे से एक व्यंजन चुनें। यही विकल्प क्रू को भेजा जाएगा।','Specific dish choices are not configured for this category yet.':'इस श्रेणी के लिए व्यंजन विकल्प अभी उपलब्ध नहीं हैं।','Please select one specific dish before saving your meal.':'भोजन सेव करने से पहले एक विशिष्ट व्यंजन चुनें।','Select one specific dish':'एक विशिष्ट व्यंजन चुनें','Select a meal and a specific dish':'भोजन और एक विशिष्ट व्यंजन चुनें','Selected:':'चयनित:','Dish selected':'व्यंजन चुना गया'},
    bn: {'STEP 2 · SPECIFIC DISH':'ধাপ ২ · নির্দিষ্ট পদ','Choose the dish you want':'আপনার পছন্দের পদ বেছে নিন','The crew dashboard and any late-change request will use this exact dish, not just the meal category.':'ক্রু ড্যাশবোর্ড ও শেষ মুহূর্তের অনুরোধে শুধু খাবারের ধরন নয়, এই নির্দিষ্ট পদটি দেখানো হবে।','Choose a meal category first, then select one dish.':'প্রথমে খাবারের ধরন বেছে নিন, তারপর একটি পদ বেছে নিন।','Choose one dish below. This exact choice is sent to the crew.':'নিচে থেকে একটি পদ বেছে নিন। এই পছন্দটি ক্রু-র কাছে যাবে।','Specific dish choices are not configured for this category yet.':'এই ধরনের খাবারের জন্য নির্দিষ্ট পদ এখনও যোগ করা হয়নি।','Please select one specific dish before saving your meal.':'খাবার সংরক্ষণের আগে একটি নির্দিষ্ট পদ বেছে নিন।','Select one specific dish':'একটি নির্দিষ্ট পদ বেছে নিন','Select a meal and a specific dish':'একটি খাবারের ধরন ও নির্দিষ্ট পদ বেছে নিন','Selected:':'নির্বাচিত:','Dish selected':'পদ বেছে নেওয়া হয়েছে'},
    mr: {'STEP 2 · SPECIFIC DISH':'टप्पा २ · विशिष्ट पदार्थ','Choose the dish you want':'तुमच्या आवडीचा पदार्थ निवडा','The crew dashboard and any late-change request will use this exact dish, not just the meal category.':'क्रू डॅशबोर्ड आणि उशिराच्या विनंतीत फक्त जेवणाचा प्रकार नव्हे, तर हाच पदार्थ दिसेल.','Choose a meal category first, then select one dish.':'प्रथम जेवणाचा प्रकार निवडा, नंतर एक पदार्थ निवडा.','Choose one dish below. This exact choice is sent to the crew.':'खालीलपैकी एक पदार्थ निवडा. हीच निवड क्रूला पाठवली जाईल.','Specific dish choices are not configured for this category yet.':'या प्रकारासाठी विशिष्ट पदार्थांचे पर्याय अद्याप उपलब्ध नाहीत.','Please select one specific dish before saving your meal.':'जेवण जतन करण्यापूर्वी एक विशिष्ट पदार्थ निवडा.','Select one specific dish':'एक विशिष्ट पदार्थ निवडा','Select a meal and a specific dish':'जेवणाचा प्रकार आणि विशिष्ट पदार्थ निवडा','Selected:':'निवडलेले:','Dish selected':'पदार्थ निवडला'},
    te: {'STEP 2 · SPECIFIC DISH':'దశ 2 · నిర్దిష్ట వంటకం','Choose the dish you want':'మీకు కావలసిన వంటకాన్ని ఎంచుకోండి','The crew dashboard and any late-change request will use this exact dish, not just the meal category.':'క్రూ డ్యాష్‌బోర్డ్ మరియు చివరి మార్పు అభ్యర్థనలో భోజన వర్గం మాత్రమే కాకుండా ఈ వంటకం కనిపిస్తుంది.','Choose a meal category first, then select one dish.':'ముందుగా భోజన వర్గాన్ని ఎంచుకుని, తరువాత ఒక వంటకాన్ని ఎంచుకోండి.','Choose one dish below. This exact choice is sent to the crew.':'క్రింద ఒక వంటకాన్ని ఎంచుకోండి. ఈ ఎంపిక క్రూకు పంపబడుతుంది.','Specific dish choices are not configured for this category yet.':'ఈ వర్గానికి నిర్దిష్ట వంటకాల ఎంపికలు ఇంకా లేవు.','Please select one specific dish before saving your meal.':'భోజనాన్ని సేవ్ చేయడానికి ముందు ఒక నిర్దిష్ట వంటకాన్ని ఎంచుకోండి.','Select one specific dish':'ఒక నిర్దిష్ట వంటకాన్ని ఎంచుకోండి','Select a meal and a specific dish':'భోజన వర్గం మరియు నిర్దిష్ట వంటకాన్ని ఎంచుకోండి','Selected:':'ఎంచుకున్నది:','Dish selected':'వంటకం ఎంచుకున్నారు'},
    ta: {'STEP 2 · SPECIFIC DISH':'படி 2 · குறிப்பிட்ட உணவு','Choose the dish you want':'உங்களுக்கு விருப்பமான உணவைத் தேர்ந்தெடுக்கவும்','The crew dashboard and any late-change request will use this exact dish, not just the meal category.':'குழு டாஷ்போர்டிலும் தாமதமான மாற்றக் கோரிக்கையிலும் உணவு வகை மட்டுமல்ல, இந்த குறிப்பிட்ட உணவும் காட்டப்படும்.','Choose a meal category first, then select one dish.':'முதலில் உணவு வகையைத் தேர்ந்தெடுத்து, பின்னர் ஒரு உணவைத் தேர்ந்தெடுக்கவும்.','Choose one dish below. This exact choice is sent to the crew.':'கீழே ஒரு உணவைத் தேர்ந்தெடுக்கவும். இந்தத் தேர்வு குழுவுக்கு அனுப்பப்படும்.','Specific dish choices are not configured for this category yet.':'இந்த வகைக்கு குறிப்பிட்ட உணவுத் தேர்வுகள் இன்னும் அமைக்கப்படவில்லை.','Please select one specific dish before saving your meal.':'உணவைச் சேமிப்பதற்கு முன் ஒரு குறிப்பிட்ட உணவைத் தேர்ந்தெடுக்கவும்.','Select one specific dish':'ஒரு குறிப்பிட்ட உணவைத் தேர்ந்தெடுக்கவும்','Select a meal and a specific dish':'உணவு வகையையும் குறிப்பிட்ட உணவையும் தேர்ந்தெடுக்கவும்','Selected:':'தேர்ந்தெடுக்கப்பட்டது:','Dish selected':'உணவு தேர்ந்தெடுக்கப்பட்டது'},
    ja: {'STEP 2 · SPECIFIC DISH':'ステップ2 · 具体的な料理','Choose the dish you want':'希望する料理を選択してください','The crew dashboard and any late-change request will use this exact dish, not just the meal category.':'乗務員画面と直前変更リクエストには、食事カテゴリだけでなく選択した料理が表示されます。','Choose a meal category first, then select one dish.':'まず食事カテゴリを選び、次に料理を1つ選択してください。','Choose one dish below. This exact choice is sent to the crew.':'下から料理を1つ選択してください。この選択が乗務員に送信されます。','Specific dish choices are not configured for this category yet.':'このカテゴリの料理選択はまだ設定されていません。','Please select one specific dish before saving your meal.':'食事を保存する前に料理を1つ選択してください。','Select one specific dish':'具体的な料理を1つ選択','Select a meal and a specific dish':'食事カテゴリと具体的な料理を選択','Selected:':'選択済み:','Dish selected':'料理を選択しました'}
  };
  const tx = (key) => (productTranslations[document.documentElement.lang] || {})[key] || key;

  const selectedCategory = () => categoryInputs.find((input) => input.checked)?.value || "";
  const dishFor = (category, code) => (catalog[category] || []).find((dish) => dish.code === code);
  const categoryNameFor = (category) => {
    const input = categoryInputs.find((item) => item.value === category);
    return input?.closest(".tile")?.querySelector("b")?.textContent?.trim() || category;
  };
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function updateStepControls() {
    const category = selectedCategory();
    const dish = dishFor(category, dishInput.value);
    if (continueButton) {
      continueButton.hidden = pickerStep !== 1;
      continueButton.disabled = !category;
    }
    if (backButton) backButton.hidden = pickerStep !== 2;
    if (saveButton) {
      saveButton.hidden = pickerStep !== 2;
      saveButton.disabled = pickerStep !== 2 || !category || !dish;
    }
    if (passengerNoteBox) passengerNoteBox.hidden = pickerStep !== 2 || !dish;
    if (footnote) {
      if (pickerStep === 1) {
        footnote.textContent = category ? `Selected category: ${categoryNameFor(category)}` : "Choose a meal category to continue";
      } else if (dish) {
        footnote.textContent = `${dish.name} · ${tx("Dish selected")}`;
      } else {
        footnote.textContent = tx("Select one specific dish");
      }
    }
    picker.dataset.step = String(pickerStep);
  }

  function showStep(step, focusHeading = false) {
    pickerStep = step === 2 && selectedCategory() ? 2 : 1;
    if (categoryStep) categoryStep.hidden = pickerStep !== 1;
    if (productPanel) productPanel.hidden = pickerStep !== 2;
    updateStepControls();
    if (pickerContent) pickerContent.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    if (focusHeading && pickerStep === 2) {
      const heading = productPanel.querySelector("#pw-product-title");
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  function renderProducts(category, preferredCode = "") {
    currentCategory = category;
    productGrid.replaceChildren();
    if (!category) {
      selectedDish = "";
      dishInput.value = "";
      productStatus.textContent = tx("Choose a meal category first, then select one dish.");
      updateStepControls();
      return;
    }
    const dishes = catalog[category] || [];
    if (!dishes.length) {
      selectedDish = "";
      dishInput.value = "";
      productStatus.textContent = tx("Specific dish choices are not configured for this category yet.");
      updateStepControls();
      return;
    }
    dishes.forEach((dish, index) => {
      const label = document.createElement("label");
      label.className = "pw-product-option";
      label.style.setProperty("--product-delay", `${Math.min(index * 35, 210)}ms`);
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "pw-product-radio";
      radio.value = dish.code;
      radio.checked = dish.code === preferredCode;
      const copy = document.createElement("span");
      copy.className = "pw-product-copy";
      const title = document.createElement("strong");
      title.textContent = dish.name;
      const desc = document.createElement("small");
      desc.textContent = dish.description || "Prepared as part of this meal category.";
      const check = document.createElement("span");
      check.className = "pw-product-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      copy.append(title, desc);
      label.append(radio, copy, check);
      productGrid.append(label);
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        selectedDish = dish.code;
        dishInput.value = dish.code;
        productStatus.textContent = `${tx("Selected:")} ${dish.name}`;
        productStatus.classList.remove("is-error");
        updateStepControls();
      });
    });
    const matching = dishFor(category, preferredCode);
    if (matching) {
      selectedDish = matching.code;
      dishInput.value = matching.code;
      productStatus.textContent = `${tx("Selected:")} ${matching.name}`;
    } else {
      selectedDish = "";
      dishInput.value = "";
      productStatus.textContent = tx("Choose one dish below. This exact choice is sent to the crew.");
    }
    updateStepControls();
  }

  function translateProductUi() {
    const step = productPanel.querySelector(".pw-product-step");
    const title = productPanel.querySelector("#pw-product-title");
    const description = productPanel.querySelector(".pw-product-heading p");
    if (step) step.textContent = tx("STEP 2 · SPECIFIC DISH");
    if (title) title.textContent = tx("Choose the dish you want");
    if (description) description.textContent = tx("The crew dashboard and any late-change request will use this exact dish, not just the meal category.");
    const dish = dishFor(currentCategory, dishInput.value);
    if (dish) productStatus.textContent = `${tx("Selected:")} ${dish.name}`;
    else if (!currentCategory) productStatus.textContent = tx("Choose a meal category first, then select one dish.");
    else productStatus.textContent = tx("Choose one dish below. This exact choice is sent to the crew.");
    updateStepControls();
  }
  document.addEventListener("skybite:languagechange", translateProductUi);
  translateProductUi();

  // Open on step one every time. An existing category is preselected, and the passenger can
  // continue to its dish or choose a different category. The footer remains visible at all times.
  document.querySelectorAll("[data-open-picker]").forEach((button) => {
    button.addEventListener("click", () => {
      chosenPax = button.dataset.pax || "";
      originalCategory = button.dataset.current || "";
      originalDish = button.dataset.currentDish || "";
      selectedDish = originalDish;
      dishInput.value = originalDish;
      categoryInputs.forEach((input) => { input.checked = input.value === originalCategory; });
      if (originalCategory) renderProducts(originalCategory, originalDish);
      else renderProducts("");
      if (passengerNoteBox) {
        const note = picker.querySelector("#passenger-note");
        if (note) note.value = "";
        const counter = picker.querySelector("#passenger-note-count");
        if (counter) counter.textContent = "0 / 160";
      }
      showStep(1);
    });
  });

  categoryInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const preserve = input.value === currentCategory ? dishInput.value : "";
      renderProducts(input.value, preserve);
      showStep(2, true);
    });
  });

  continueButton?.addEventListener("click", () => {
    const category = selectedCategory();
    if (!category) return;
    const preserve = category === currentCategory ? dishInput.value : (category === originalCategory ? originalDish : "");
    renderProducts(category, preserve);
    showStep(2, true);
  });

  backButton?.addEventListener("click", () => showStep(1));

  form.addEventListener("submit", (event) => {
    const category = selectedCategory();
    const match = dishFor(category, dishInput.value);
    if (!category) {
      event.preventDefault();
      showStep(1);
      footnote.textContent = tx("Select a meal and a specific dish");
      return;
    }
    if (!match) {
      event.preventDefault();
      renderProducts(category, "");
      showStep(2, true);
      productStatus.textContent = tx("Please select one specific dish before saving your meal.");
      productStatus.classList.remove("is-error");
      void productStatus.offsetWidth;
      productStatus.classList.add("is-error");
      updateStepControls();
      return;
    }
    dishInput.value = match.code;
    if (saveButton) {
      saveButton.disabled = true;
      const label = saveButton.querySelector("[data-picker-submit-label]");
      if (label) label.textContent = "Saving…";
    }
  });

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input?.name === "pw-product-radio" && input.checked) selectedDish = input.value;
  });
  showStep(1);
})();
