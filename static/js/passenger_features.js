(() => {
  'use strict';

  const pwRoot = document.querySelector('[data-pw-language]');
  if (!pwRoot) return;

  const pwSelect = pwRoot.querySelector('.pw-language-select');
  const pwStatus = pwRoot.querySelector('.pw-language-status');
  const pwCsrf = pwRoot.querySelector('.pw-language-csrf');
  const pwInitial = pwRoot.querySelector('.pw-language-current');
  const pwOriginalText = new WeakMap();

  // Translate interface labels only; meal names, passenger names, route data and animations stay intact.
  const pwTranslations = {
    hi: {
      'Language': 'भाषा', 'Journey': 'यात्रा', 'Menu': 'मेन्यू', 'Meal choices': 'भोजन विकल्प', 'Details': 'विवरण',
      'Sign out ↗': 'साइन आउट ↗', 'DEPARTURE': 'प्रस्थान', 'ARRIVAL': 'आगमन', 'FLIGHT': 'उड़ान', 'DEPARTS': 'प्रस्थान समय',
      'MEAL CUTOFF': 'भोजन चुनने की अंतिम समय-सीमा', 'READY FOR DEPARTURE': 'प्रस्थान के लिए तैयार', 'SCROLL': 'नीचे जाएँ', '✳ WELCOME ABOARD,': '✳ आपका स्वागत है, ', 'Good food takes': 'अच्छा भोजन आपको', 'you': 'आगे ', 'further.': 'ले जाता है।', 'Thoughtfully prepared meals for flight': 'उड़ान के लिए सोच-समझकर तैयार भोजन ', '. Scroll to follow your route to ': '। अपना मार्ग देखने के लिए स्क्रॉल करें: ', 'Flavours for': 'स्वाद, ', 'every journey.': 'हर यात्रा के लिए।', 'All set for': 'तैयार हैं ', 'take-off.': 'उड़ान के लिए।',
      '✳ CURATED FOR YOUR JOURNEY': '✳ आपकी यात्रा के लिए चुना गया', 'Flavours for': 'स्वाद, ', 'every journey.': 'हर यात्रा के लिए।',
      "✳ THE PEOPLE ON THIS BOOKING": '✳ इस बुकिंग के यात्री', "Everyone's meal, ": 'हर यात्री का भोजन, ', 'their way.': 'उनकी पसंद का।',
      'Pick a meal for each traveller. Choices sync to the crew team.': 'हर यात्री के लिए भोजन चुनें। विकल्प क्रू टीम के साथ साझा होंगे।',
      'MEAL CHOSEN': 'भोजन चुना गया', 'MEAL NOT CHOSEN': 'भोजन नहीं चुना गया', 'No meal chosen yet': 'अभी भोजन नहीं चुना गया',
      'Pick something that suits you.': 'अपनी पसंद का भोजन चुनें।', 'Change meal': 'भोजन बदलें', 'Choose a meal': 'भोजन चुनें',
      '✓ Meal orders are closed for this flight.': '✓ इस उड़ान के लिए भोजन ऑर्डर बंद हैं।', 'THE PRACTICAL DETAILS': 'ज़रूरी विवरण',
      'All set for': 'तैयार हैं ', 'take-off.': 'उड़ान के लिए।', 'DEPARTURE': 'प्रस्थान', 'Better meals.': 'बेहतर भोजन।',
      'Happier journeys.': 'खुशहाल यात्राएँ।', 'Your seat is waiting. Choose something you\'ll look forward to.': 'आपकी सीट तैयार है। अपनी पसंद का भोजन चुनें।',
      'Choose my meals': 'मेरे भोजन चुनें', 'Good taste travels. ✳': 'स्वाद भी साथ चलता है। ✳',
      'MADE TO SUIT YOU': 'आपकी पसंद के अनुसार', 'SEASONAL FAVOURITE': 'मौसमी पसंद', 'Choose for my booking →': 'मेरी बुकिंग के लिए चुनें →',
      'Choose a meal': 'भोजन चुनें', 'Select one meal': 'एक भोजन चुनें', 'Save this meal': 'यह भोजन सेव करें'
    },
    bn: {
      'Language': 'ভাষা', 'Journey': 'যাত্রা', 'Menu': 'মেনু', 'Meal choices': 'খাবারের পছন্দ', 'Details': 'বিবরণ', 'Sign out ↗': 'সাইন আউট ↗',
      'DEPARTURE': 'প্রস্থান', 'ARRIVAL': 'আগমন', 'FLIGHT': 'ফ্লাইট', 'DEPARTS': 'প্রস্থানের সময়', 'MEAL CUTOFF': 'খাবার বাছাইয়ের শেষ সময়',
      'READY FOR DEPARTURE': 'যাত্রার জন্য প্রস্তুত', 'SCROLL': 'স্ক্রল করুন', 'Good food takes': 'ভালো খাবার আপনাকে', 'you': 'এগিয়ে ', 'further.': 'নিয়ে যায়।', 'Thoughtfully prepared meals for flight': 'ফ্লাইটের জন্য যত্নসহকারে তৈরি খাবার ', 'Flavours for': 'স্বাদের ছোঁয়া, ', 'every journey.': 'প্রতিটি যাত্রায়।', 'All set for': 'প্রস্তুত ', 'take-off.': 'উড্ডয়নের জন্য।', '✳ CURATED FOR YOUR JOURNEY': '✳ আপনার যাত্রার জন্য বাছাই করা',
      '✳ THE PEOPLE ON THIS BOOKING': '✳ এই বুকিংয়ের যাত্রীরা', "Everyone's meal, ": 'প্রত্যেকের খাবার, ', 'their way.': 'নিজের পছন্দে।',
      'Pick a meal for each traveller. Choices sync to the crew team.': 'প্রত্যেক যাত্রীর জন্য খাবার বেছে নিন। পছন্দ ক্রু দলের সঙ্গে শেয়ার হবে।',
      'MEAL CHOSEN': 'খাবার বেছে নেওয়া হয়েছে', 'MEAL NOT CHOSEN': 'খাবার বেছে নেওয়া হয়নি', 'No meal chosen yet': 'এখনও খাবার বাছা হয়নি',
      'Pick something that suits you.': 'আপনার পছন্দের খাবার বেছে নিন।', 'Change meal': 'খাবার বদলান', 'Choose a meal': 'খাবার বেছে নিন',
      'THE PRACTICAL DETAILS': 'প্রয়োজনীয় তথ্য', 'Better meals.': 'আরও ভালো খাবার।', 'Happier journeys.': 'আরও আনন্দময় যাত্রা।',
      'Your seat is waiting. Choose something you\'ll look forward to.': 'আপনার আসন প্রস্তুত। পছন্দের খাবার বেছে নিন।', 'Choose my meals': 'আমার খাবার বেছে নিন',
      'MADE TO SUIT YOU': 'আপনার পছন্দমতো', 'SEASONAL FAVOURITE': 'মৌসুমি পছন্দ', 'Choose for my booking →': 'আমার বুকিংয়ের জন্য বেছে নিন →',
      'Select one meal': 'একটি খাবার বেছে নিন', 'Save this meal': 'এই খাবার সংরক্ষণ করুন'
    },
    mr: {
      'Language': 'भाषा', 'Journey': 'प्रवास', 'Menu': 'मेनू', 'Meal choices': 'जेवणाचे पर्याय', 'Details': 'तपशील', 'Sign out ↗': 'साइन आउट ↗',
      'DEPARTURE': 'प्रस्थान', 'ARRIVAL': 'आगमन', 'FLIGHT': 'विमान', 'DEPARTS': 'प्रस्थानाची वेळ', 'MEAL CUTOFF': 'जेवण निवडण्याची अंतिम वेळ',
      'READY FOR DEPARTURE': 'प्रवासासाठी सज्ज', 'SCROLL': 'खाली जा', 'Good food takes': 'चांगले अन्न तुम्हाला', 'you': 'पुढे ', 'further.': 'घेऊन जाते.', 'Thoughtfully prepared meals for flight': 'विमानप्रवासासाठी विचारपूर्वक तयार केलेले जेवण ', 'Flavours for': 'चवींची मेजवानी, ', 'every journey.': 'प्रत्येक प्रवासासाठी.', 'All set for': 'सज्ज व्हा ', 'take-off.': 'उड्डाणासाठी.', '✳ CURATED FOR YOUR JOURNEY': '✳ तुमच्या प्रवासासाठी निवडलेले',
      '✳ THE PEOPLE ON THIS BOOKING': '✳ या बुकिंगमधील प्रवासी', "Everyone's meal, ": 'प्रत्येकाचे जेवण, ', 'their way.': 'त्यांच्या पसंतीचे.',
      'Pick a meal for each traveller. Choices sync to the crew team.': 'प्रत्येक प्रवाशासाठी जेवण निवडा. निवडी क्रू टीमसोबत शेअर होतील.',
      'MEAL CHOSEN': 'जेवण निवडले', 'MEAL NOT CHOSEN': 'जेवण निवडलेले नाही', 'No meal chosen yet': 'अजून जेवण निवडलेले नाही',
      'Pick something that suits you.': 'तुमच्या पसंतीचे जेवण निवडा.', 'Change meal': 'जेवण बदला', 'Choose a meal': 'जेवण निवडा',
      'THE PRACTICAL DETAILS': 'महत्त्वाचे तपशील', 'Better meals.': 'चांगले जेवण.', 'Happier journeys.': 'आनंदी प्रवास.',
      'Your seat is waiting. Choose something you\'ll look forward to.': 'तुमची सीट तयार आहे. आवडीचे जेवण निवडा.', 'Choose my meals': 'माझे जेवण निवडा',
      'MADE TO SUIT YOU': 'तुमच्या पसंतीनुसार', 'SEASONAL FAVOURITE': 'हंगामी आवड', 'Choose for my booking →': 'माझ्या बुकिंगसाठी निवडा →',
      'Select one meal': 'एक जेवण निवडा', 'Save this meal': 'हे जेवण जतन करा'
    },
    te: {
      'Language': 'భాష', 'Journey': 'ప్రయాణం', 'Menu': 'మెనూ', 'Meal choices': 'భోజన ఎంపికలు', 'Details': 'వివరాలు', 'Sign out ↗': 'సైన్ అవుట్ ↗',
      'DEPARTURE': 'ప్రయాణ ప్రారంభం', 'ARRIVAL': 'గమ్యం', 'FLIGHT': 'విమానము', 'DEPARTS': 'ప్రయాణ సమయం', 'MEAL CUTOFF': 'భోజన ఎంపిక చివరి సమయం',
      'READY FOR DEPARTURE': 'ప్రయాణానికి సిద్ధం', 'SCROLL': 'కిందికి స్క్రోల్ చేయండి', 'Good food takes': 'మంచి ఆహారం మిమ్మల్ని', 'you': 'మరింత ', 'further.': 'ముందుకు తీసుకెళ్తుంది.', 'Thoughtfully prepared meals for flight': 'విమాన ప్రయాణం కోసం శ్రద్ధగా సిద్ధం చేసిన భోజనం ', 'Flavours for': 'రుచులు, ', 'every journey.': 'ప్రతి ప్రయాణానికి.', 'All set for': 'సిద్ధంగా ఉండండి ', 'take-off.': 'విమాన ప్రయాణానికి.', '✳ CURATED FOR YOUR JOURNEY': '✳ మీ ప్రయాణం కోసం ఎంపిక చేసినవి',
      '✳ THE PEOPLE ON THIS BOOKING': '✳ ఈ బుకింగ్‌లోని ప్రయాణికులు', "Everyone's meal, ": 'ప్రతి ఒక్కరి భోజనం, ', 'their way.': 'వారి ఇష్టానుసారం.',
      'Pick a meal for each traveller. Choices sync to the crew team.': 'ప్రతి ప్రయాణికుడికి భోజనం ఎంచుకోండి. ఎంపికలు క్రూ బృందంతో సమకాలీకరించబడతాయి.',
      'MEAL CHOSEN': 'భోజనం ఎంచుకున్నారు', 'MEAL NOT CHOSEN': 'భోజనం ఎంచుకోలేదు', 'No meal chosen yet': 'ఇంకా భోజనం ఎంచుకోలేదు',
      'Pick something that suits you.': 'మీకు నచ్చిన భోజనాన్ని ఎంచుకోండి.', 'Change meal': 'భోజనం మార్చండి', 'Choose a meal': 'భోజనం ఎంచుకోండి',
      'THE PRACTICAL DETAILS': 'ముఖ్యమైన వివరాలు', 'Better meals.': 'మెరుగైన భోజనం.', 'Happier journeys.': 'ఆనందమైన ప్రయాణాలు.',
      'Your seat is waiting. Choose something you\'ll look forward to.': 'మీ సీటు సిద్ధంగా ఉంది. మీకు నచ్చిన భోజనం ఎంచుకోండి.', 'Choose my meals': 'నా భోజనాన్ని ఎంచుకోండి',
      'MADE TO SUIT YOU': 'మీకు అనుగుణంగా', 'SEASONAL FAVOURITE': 'సీజన్ ప్రత్యేకం', 'Choose for my booking →': 'నా బుకింగ్ కోసం ఎంచుకోండి →',
      'Select one meal': 'ఒక భోజనం ఎంచుకోండి', 'Save this meal': 'ఈ భోజనాన్ని సేవ్ చేయండి'
    },
    ta: {
      'Language': 'மொழி', 'Journey': 'பயணம்', 'Menu': 'பட்டியல்', 'Meal choices': 'உணவு தேர்வுகள்', 'Details': 'விவரங்கள்', 'Sign out ↗': 'வெளியேறு ↗',
      'DEPARTURE': 'புறப்பாடு', 'ARRIVAL': 'வருகை', 'FLIGHT': 'விமானம்', 'DEPARTS': 'புறப்படும் நேரம்', 'MEAL CUTOFF': 'உணவு தேர்வுக்கான கடைசி நேரம்',
      'READY FOR DEPARTURE': 'பயணத்திற்குத் தயார்', 'SCROLL': 'கீழே உருட்டவும்', 'Good food takes': 'நல்ல உணவு உங்களை', 'you': 'மேலும் ', 'further.': 'முன்னே அழைத்துச் செல்லும்.', 'Thoughtfully prepared meals for flight': 'விமானப் பயணத்திற்காக கவனமாகத் தயாரிக்கப்பட்ட உணவு ', 'Flavours for': 'சுவைகள், ', 'every journey.': 'ஒவ்வொரு பயணத்திற்கும்.', 'All set for': 'தயாராகுங்கள் ', 'take-off.': 'புறப்படுவதற்கு.', '✳ CURATED FOR YOUR JOURNEY': '✳ உங்கள் பயணத்திற்காகத் தேர்ந்தெடுக்கப்பட்டது',
      '✳ THE PEOPLE ON THIS BOOKING': '✳ இந்த முன்பதிவில் உள்ள பயணிகள்', "Everyone's meal, ": 'ஒவ்வொருவரின் உணவும், ', 'their way.': 'அவரவர் விருப்பப்படி.',
      'Pick a meal for each traveller. Choices sync to the crew team.': 'ஒவ்வொரு பயணிக்கும் உணவைத் தேர்ந்தெடுக்கவும். தேர்வுகள் குழுவுடன் பகிரப்படும்.',
      'MEAL CHOSEN': 'உணவு தேர்ந்தெடுக்கப்பட்டது', 'MEAL NOT CHOSEN': 'உணவு தேர்ந்தெடுக்கப்படவில்லை', 'No meal chosen yet': 'இன்னும் உணவு தேர்வு செய்யப்படவில்லை',
      'Pick something that suits you.': 'உங்களுக்குப் பிடித்த உணவைத் தேர்ந்தெடுக்கவும்.', 'Change meal': 'உணவை மாற்றவும்', 'Choose a meal': 'உணவைத் தேர்ந்தெடுக்கவும்',
      'THE PRACTICAL DETAILS': 'முக்கிய விவரங்கள்', 'Better meals.': 'சிறந்த உணவு.', 'Happier journeys.': 'மகிழ்ச்சியான பயணங்கள்.',
      'Your seat is waiting. Choose something you\'ll look forward to.': 'உங்கள் இருக்கை தயாராக உள்ளது. விருப்பமான உணவைத் தேர்ந்தெடுக்கவும்.', 'Choose my meals': 'எனது உணவைத் தேர்ந்தெடுக்கவும்',
      'MADE TO SUIT YOU': 'உங்கள் விருப்பத்திற்கு ஏற்ப', 'SEASONAL FAVOURITE': 'பருவகால விருப்பம்', 'Choose for my booking →': 'எனது முன்பதிவிற்குத் தேர்வு செய்க →',
      'Select one meal': 'ஒரு உணவைத் தேர்ந்தெடுக்கவும்', 'Save this meal': 'இந்த உணவைச் சேமிக்கவும்'
    },
    ja: {
      'Language': '言語', 'Journey': '旅程', 'Menu': 'メニュー', 'Meal choices': '食事の選択', 'Details': '詳細', 'Sign out ↗': 'サインアウト ↗',
      'DEPARTURE': '出発', 'ARRIVAL': '到着', 'FLIGHT': '便名', 'DEPARTS': '出発時刻', 'MEAL CUTOFF': '食事選択の締切',
      'READY FOR DEPARTURE': '出発準備完了', 'SCROLL': 'スクロール', 'Good food takes': 'おいしい食事があなたを', 'you': 'さらに ', 'further.': '遠くへ導きます。', 'Thoughtfully prepared meals for flight': 'フライトのために丁寧に用意された食事 ', 'Flavours for': '味わいを、', 'every journey.': 'すべての旅に。', 'All set for': 'さあ、準備は万端 ', 'take-off.': '出発しましょう。', '✳ CURATED FOR YOUR JOURNEY': '✳ 旅に合わせたメニュー',
      '✳ THE PEOPLE ON THIS BOOKING': '✳ この予約の搭乗者', "Everyone's meal, ": '一人ひとりの食事を、', 'their way.': 'お好みに合わせて。',
      'Pick a meal for each traveller. Choices sync to the crew team.': '搭乗者ごとに食事を選択してください。選択内容は乗務員チームと共有されます。',
      'MEAL CHOSEN': '食事選択済み', 'MEAL NOT CHOSEN': '食事未選択', 'No meal chosen yet': '食事は未選択です',
      'Pick something that suits you.': 'お好みの食事を選んでください。', 'Change meal': '食事を変更', 'Choose a meal': '食事を選ぶ',
      'THE PRACTICAL DETAILS': 'ご利用案内', 'Better meals.': 'もっとおいしい食事。', 'Happier journeys.': 'もっと快適な旅。',
      'Your seat is waiting. Choose something you\'ll look forward to.': '座席の準備ができています。お好みの食事を選んでください。', 'Choose my meals': '食事を選ぶ',
      'MADE TO SUIT YOU': 'お好みに合わせて', 'SEASONAL FAVOURITE': '季節のおすすめ', 'Choose for my booking →': '予約の食事を選ぶ →',
      'Select one meal': '食事を1つ選択', 'Save this meal': 'この食事を保存'
    }
  };

  // Meal-picker labels and descriptions are translated separately so the same picker works in every language.
  const pwMealTranslations = {
    hi: {
      'Navratri vrat thali':'नवरात्रि व्रत थाली','Ekadashi fasting meal':'एकादशी व्रत भोजन','Ramzan iftar and suhoor box':'रमज़ान इफ्तार और सहरी बॉक्स','Strict Jain':'सख्त जैन भोजन','Sattvik':'सात्त्विक भोजन','Halal non-vegetarian':'हलाल मांसाहारी भोजन','Vegetarian':'शाकाहारी भोजन','Non-vegetarian':'मांसाहारी भोजन','Diabetic friendly':'मधुमेह-अनुकूल भोजन','Low sodium':'कम सोडियम वाला भोजन','Nut-free':'मेवों से मुक्त भोजन','Gluten-free':'ग्लूटेन-मुक्त भोजन','Child meal':'बच्चों का भोजन',
      'Sabudana khichdi, kuttu roti and sendha namak. No grains, onion or garlic.':'साबूदाना खिचड़ी, कुट्टू रोटी और सेंधा नमक। अनाज, प्याज़ या लहसुन नहीं।','Fruit, makhana and a light potato dish cooked with rock salt. No grains or pulses.':'फल, मखाना और सेंधा नमक में बना हल्का आलू व्यंजन। अनाज या दालें नहीं।','Dates, fruit chaat and a hot halal meal, served at sunset or before dawn.':'खजूर, फ्रूट चाट और सूर्यास्त या सुबह से पहले परोसा जाने वाला गर्म हलाल भोजन।','No onion, garlic or root vegetables such as potato, carrot, beetroot and radish.':'प्याज़, लहसुन या आलू, गाजर, चुकंदर और मूली जैसी जड़ वाली सब्ज़ियाँ नहीं।','Freshly cooked and light. No onion, garlic, meat, eggs or alcohol.':'ताज़ा बना हल्का भोजन। प्याज़, लहसुन, मांस, अंडे या शराब नहीं।','Halal-certified chicken or mutton curry with rice or roti.':'हलाल प्रमाणित चिकन या मटन करी, चावल या रोटी के साथ।','Paneer or dal with rice or roti and a seasonal vegetable.':'पनीर या दाल, चावल या रोटी और मौसमी सब्ज़ी के साथ।','Chicken curry with rice or roti.':'चिकन करी, चावल या रोटी के साथ।','Low sugar and high fibre, with whole grains.':'कम चीनी और अधिक फाइबर, साबुत अनाज के साथ।','Cooked with very little salt. No pickle or papad.':'बहुत कम नमक में बना। अचार या पापड़ नहीं।','Made without peanuts or tree nuts and sealed separately.':'मूंगफली या पेड़ों पर उगने वाले मेवों के बिना बनाया गया और अलग से सीलबंद।','No wheat, barley or semolina. Rice-based.':'गेहूँ, जौ या सूजी नहीं। चावल आधारित।','Mild flavours with fruit and a milk drink.':'हल्का स्वाद, फल और दूध के पेय के साथ。'
    },
    bn: {
      'Navratri vrat thali':'নবরাত্রি ব্রতের থালি','Ekadashi fasting meal':'একাদশী উপবাসের খাবার','Ramzan iftar and suhoor box':'রমজানের ইফতার ও সেহরির বাক্স','Strict Jain':'কঠোর জৈন খাবার','Sattvik':'সাত্ত্বিক খাবার','Halal non-vegetarian':'হালাল আমিষ খাবার','Vegetarian':'নিরামিষ খাবার','Non-vegetarian':'আমিষ খাবার','Diabetic friendly':'ডায়াবেটিস-বান্ধব খাবার','Low sodium':'কম সোডিয়াম খাবার','Nut-free':'বাদাম-মুক্ত খাবার','Gluten-free':'গ্লুটেন-মুক্ত খাবার','Child meal':'শিশুদের খাবার',
      'Sabudana khichdi, kuttu roti and sendha namak. No grains, onion or garlic.':'সাবুদানা খিচুড়ি, কুট্টুর রুটি ও সেন্ধা লবণ। শস্য, পেঁয়াজ বা রসুন নেই।','No onion, garlic or root vegetables such as potato, carrot, beetroot and radish.':'পেঁয়াজ, রসুন বা আলু, গাজর, বিট ও মুলোর মতো মূলজাতীয় সবজি নেই।','Freshly cooked and light. No onion, garlic, meat, eggs or alcohol.':'টাটকা ও হালকা খাবার। পেঁয়াজ, রসুন, মাংস, ডিম বা অ্যালকোহল নেই।','Paneer or dal with rice or roti and a seasonal vegetable.':'পনির বা ডাল, ভাত বা রুটি এবং মৌসুমি সবজি।','Chicken curry with rice or roti.':'ভাত বা রুটির সঙ্গে চিকেন কারি।','Low sugar and high fibre, with whole grains.':'কম চিনি ও বেশি ফাইবার, সম্পূর্ণ শস্যসহ।'
    },
    mr: {
      'Navratri vrat thali':'नवरात्री उपवास थाळी','Ekadashi fasting meal':'एकादशी उपवासाचे जेवण','Ramzan iftar and suhoor box':'रमजान इफ्तार आणि सहरी बॉक्स','Strict Jain':'कठोर जैन भोजन','Sattvik':'सात्त्विक भोजन','Halal non-vegetarian':'हलाल मांसाहारी भोजन','Vegetarian':'शाकाहारी भोजन','Non-vegetarian':'मांसाहारी भोजन','Diabetic friendly':'मधुमेहासाठी अनुकूल','Low sodium':'कमी सोडियमचे भोजन','Nut-free':'सुकामेव्याविना भोजन','Gluten-free':'ग्लूटेन-मुक्त भोजन','Child meal':'मुलांचे जेवण',
      'Sabudana khichdi, kuttu roti and sendha namak. No grains, onion or garlic.':'साबुदाणा खिचडी, कुट्टू रोटी आणि सैंधव मीठ. धान्य, कांदा किंवा लसूण नाही.','No onion, garlic or root vegetables such as potato, carrot, beetroot and radish.':'कांदा, लसूण किंवा बटाटा, गाजर, बीट आणि मुळा यांसारख्या मुळभाज्या नाहीत.','Freshly cooked and light. No onion, garlic, meat, eggs or alcohol.':'ताजे आणि हलके जेवण. कांदा, लसूण, मांस, अंडी किंवा मद्य नाही.','Paneer or dal with rice or roti and a seasonal vegetable.':'भात किंवा पोळी आणि हंगामी भाजीसोबत पनीर किंवा डाळ.','Chicken curry with rice or roti.':'भात किंवा पोळीसोबत चिकन करी.','Low sugar and high fibre, with whole grains.':'कमी साखर आणि जास्त तंतुमय पदार्थ, संपूर्ण धान्यांसह.'
    },
    te: {
      'Navratri vrat thali':'నవరాత్రి వ్రత థాలి','Ekadashi fasting meal':'ఏకాదశి ఉపవాస భోజనం','Ramzan iftar and suhoor box':'రంజాన్ ఇఫ్తార్ మరియు సహూర్ బాక్స్','Strict Jain':'కఠిన జైన భోజనం','Sattvik':'సాత్విక భోజనం','Halal non-vegetarian':'హలాల్ మాంసాహార భోజనం','Vegetarian':'శాకాహార భోజనం','Non-vegetarian':'మాంసాహార భోజనం','Diabetic friendly':'మధుమేహానికి అనుకూలం','Low sodium':'తక్కువ సోడియం భోజనం','Nut-free':'గింజలు లేని భోజనం','Gluten-free':'గ్లూటెన్ రహిత భోజనం','Child meal':'పిల్లల భోజనం',
      'Sabudana khichdi, kuttu roti and sendha namak. No grains, onion or garlic.':'సగ్గుబియ్యం ఖిచ్డీ, కుట్టు రొట్టి, సైంధవ ఉప్పు. ధాన్యాలు, ఉల్లిపాయ లేదా వెల్లుల్లి ఉండవు.','No onion, garlic or root vegetables such as potato, carrot, beetroot and radish.':'ఉల్లిపాయ, వెల్లుల్లి లేదా బంగాళాదుంప, క్యారెట్, బీట్‌రూట్, ముల్లంగి వంటి వేరు కూరగాయలు ఉండవు.','Freshly cooked and light. No onion, garlic, meat, eggs or alcohol.':'తాజాగా వండిన తేలికపాటి ఆహారం. ఉల్లిపాయ, వెల్లుల్లి, మాంసం, గుడ్లు లేదా మద్యం ఉండవు.','Paneer or dal with rice or roti and a seasonal vegetable.':'అన్నం లేదా రొట్టె, కాలానుగుణ కూరగాయతో పనీర్ లేదా పప్పు.','Chicken curry with rice or roti.':'అన్నం లేదా రొట్టెతో చికెన్ కూర.','Low sugar and high fibre, with whole grains.':'తక్కువ చక్కెర, అధిక పీచు పదార్థాలు, సంపూర్ణ ధాన్యాలతో.'
    },
    ta: {
      'Navratri vrat thali':'நவராத்திரி விரதத் தட்டு','Ekadashi fasting meal':'ஏகாதசி விரத உணவு','Ramzan iftar and suhoor box':'ரமலான் இஃப்தார் மற்றும் சஹூர் பெட்டி','Strict Jain':'கடுமையான ஜைன உணவு','Sattvik':'சாத்வீக உணவு','Halal non-vegetarian':'ஹலால் அசைவ உணவு','Vegetarian':'சைவ உணவு','Non-vegetarian':'அசைவ உணவு','Diabetic friendly':'நீரிழிவு நோய்க்கு ஏற்ற உணவு','Low sodium':'குறைந்த சோடியம் உணவு','Nut-free':'கொட்டைகள் இல்லாத உணவு','Gluten-free':'குளூட்டன் இல்லாத உணவு','Child meal':'குழந்தைகளுக்கான உணவு',
      'Sabudana khichdi, kuttu roti and sendha namak. No grains, onion or garlic.':'ஜவ்வரிசி கிச்சடி, குட்டு ரொட்டி, கல் உப்பு. தானியங்கள், வெங்காயம் அல்லது பூண்டு இல்லை.','No onion, garlic or root vegetables such as potato, carrot, beetroot and radish.':'வெங்காயம், பூண்டு அல்லது உருளைக்கிழங்கு, கேரட், பீட்ரூட், முள்ளங்கி போன்ற வேர்க்காய்கள் இல்லை.','Freshly cooked and light. No onion, garlic, meat, eggs or alcohol.':'புதிதாகச் சமைத்த லேசான உணவு. வெங்காயம், பூண்டு, இறைச்சி, முட்டை அல்லது மது இல்லை.','Paneer or dal with rice or roti and a seasonal vegetable.':'சாதம் அல்லது ரொட்டியுடன் பனீர் அல்லது பருப்பு மற்றும் பருவகால காய்கறி.','Chicken curry with rice or roti.':'சாதம் அல்லது ரொட்டியுடன் கோழிக் கறி.','Low sugar and high fibre, with whole grains.':'குறைந்த சர்க்கரை, அதிக நார்ச்சத்து மற்றும் முழுத் தானியங்கள்.'
    },
    ja: {
      'Navratri vrat thali':'ナヴラトリ断食ターリー','Ekadashi fasting meal':'エーカーダシー断食食','Ramzan iftar and suhoor box':'ラマダンのイフタール・スフールボックス','Strict Jain':'厳格なジャイナ教食','Sattvik':'サットヴィック料理','Halal non-vegetarian':'ハラール肉料理','Vegetarian':'ベジタリアン料理','Non-vegetarian':'肉料理','Diabetic friendly':'糖尿病に配慮した食事','Low sodium':'減塩食','Nut-free':'ナッツ不使用','Gluten-free':'グルテンフリー','Child meal':'お子さま向け食事',
      'Sabudana khichdi, kuttu roti and sendha namak. No grains, onion or garlic.':'サブダナ・キチュリ、クトゥのロティ、岩塩。穀物、玉ねぎ、にんにく不使用。','No onion, garlic or root vegetables such as potato, carrot, beetroot and radish.':'玉ねぎ、にんにく、じゃがいも、にんじん、ビーツ、大根などの根菜不使用。','Freshly cooked and light. No onion, garlic, meat, eggs or alcohol.':'作りたての軽い食事。玉ねぎ、にんにく、肉、卵、アルコール不使用。','Paneer or dal with rice or roti and a seasonal vegetable.':'パニールまたは豆料理に、ご飯かロティと季節の野菜。','Chicken curry with rice or roti.':'ご飯かロティ付きチキンカレー。','Low sugar and high fibre, with whole grains.':'全粒穀物を使った低糖・高食物繊維の食事。'
    }
  };

  const pwPickerTextTranslations = {
    en: {
      'Short note for crew (optional)': 'Short note for crew (optional)',
      "This note appears as an alert in the crew's Live Activity.": "This note appears as an alert in the crew's Live Activity.",
      'Keep it brief (160 characters max).': 'Keep it brief (160 characters max).',
      'MEAL CHOSEN': 'MEAL CHOSEN',
      'MEAL NOT CHOSEN': 'MEAL NOT CHOSEN',
    },
    hi: {
      'Short note for crew (optional)': 'क्रू के लिए छोटा नोट (वैकल्पिक)',
      "This note appears as an alert in the crew's Live Activity.": 'यह नोट क्रू की लाइव गतिविधि में अलर्ट के रूप में दिखेगा।',
      'Keep it brief (160 characters max).': 'संक्षिप्त रखें (अधिकतम 160 अक्षर)।',
      'MEAL CHOSEN': 'भोजन चुना गया',
      'MEAL NOT CHOSEN': 'भोजन नहीं चुना गया',
      'STEP 2 · SPECIFIC DISH': 'चरण 2 · विशिष्ट व्यंजन', 'Choose the dish you want': 'अपना पसंदीदा व्यंजन चुनें',
      'The crew dashboard and any late-change request will use this exact dish, not just the meal category.': 'क्रू डैशबोर्ड और देर से किए गए बदलाव में भोजन की श्रेणी के बजाय यही व्यंजन दिखेगा।',
      'Choose a meal category first, then select one dish.': 'पहले भोजन की श्रेणी चुनें, फिर एक व्यंजन चुनें।',
      'Choose one dish below. This exact choice is sent to the crew.': 'नीचे से एक व्यंजन चुनें। यही विकल्प क्रू को भेजा जाएगा।',
      'Specific dish choices are not configured for this category yet.': 'इस श्रेणी के लिए व्यंजन विकल्प अभी उपलब्ध नहीं हैं।',
      'Please select one specific dish before saving your meal.': 'भोजन सेव करने से पहले एक विशिष्ट व्यंजन चुनें।',
      'Select one specific dish': 'एक विशिष्ट व्यंजन चुनें', 'Select a meal and a specific dish': 'भोजन और एक विशिष्ट व्यंजन चुनें',
      'Select one dish below': 'नीचे से एक व्यंजन चुनें', 'Selected:': 'चयनित:'
    },
    bn: {
      'Short note for crew (optional)': 'ক্রুর জন্য ছোট নোট (ঐচ্ছিক)',
      "This note appears as an alert in the crew's Live Activity.": 'এই নোটটি ক্রুর লাইভ অ্যাক্টিভিটিতে সতর্কতা হিসেবে দেখাবে।',
      'Keep it brief (160 characters max).': 'সংক্ষিপ্ত রাখুন (সর্বোচ্চ ১৬০ অক্ষর)।',
      'MEAL CHOSEN': 'খাবার বেছে নেওয়া হয়েছে',
      'MEAL NOT CHOSEN': 'খাবার বেছে নেওয়া হয়নি',
      'STEP 2 · SPECIFIC DISH': 'ধাপ ২ · নির্দিষ্ট পদ', 'Choose the dish you want': 'আপনার পছন্দের পদ বেছে নিন',
      'The crew dashboard and any late-change request will use this exact dish, not just the meal category.': 'ক্রু ড্যাশবোর্ড ও শেষ মুহূর্তের অনুরোধে শুধু খাবারের ধরন নয়, এই নির্দিষ্ট পদটি দেখানো হবে।',
      'Choose a meal category first, then select one dish.': 'প্রথমে খাবারের ধরন বেছে নিন, তারপর একটি পদ বেছে নিন।',
      'Choose one dish below. This exact choice is sent to the crew.': 'নিচে থেকে একটি পদ বেছে নিন। এই পছন্দটি ক্রু-র কাছে যাবে।',
      'Specific dish choices are not configured for this category yet.': 'এই ধরনের খাবারের জন্য নির্দিষ্ট পদ এখনও যোগ করা হয়নি।',
      'Please select one specific dish before saving your meal.': 'খাবার সংরক্ষণের আগে একটি নির্দিষ্ট পদ বেছে নিন।',
      'Select one specific dish': 'একটি নির্দিষ্ট পদ বেছে নিন', 'Select a meal and a specific dish': 'একটি খাবারের ধরন ও নির্দিষ্ট পদ বেছে নিন',
      'Select one dish below': 'নিচে থেকে একটি পদ বেছে নিন', 'Selected:': 'নির্বাচিত:'
    },
    mr: {
      'Short note for crew (optional)': 'क्रूसाठी छोटी नोंद (ऐच्छिक)',
      "This note appears as an alert in the crew's Live Activity.": 'ही नोंद क्रूच्या Live Activity मध्ये अलर्ट म्हणून दिसेल.',
      'Keep it brief (160 characters max).': 'नोंद छोटी ठेवा (कमाल 160 अक्षरे).',
      'MEAL CHOSEN': 'जेवण निवडले',
      'MEAL NOT CHOSEN': 'जेवण निवडलेले नाही',
      'STEP 2 · SPECIFIC DISH': 'टप्पा २ · विशिष्ट पदार्थ', 'Choose the dish you want': 'तुमच्या आवडीचा पदार्थ निवडा',
      'The crew dashboard and any late-change request will use this exact dish, not just the meal category.': 'क्रू डॅशबोर्ड आणि उशिराच्या विनंतीत फक्त जेवणाचा प्रकार नव्हे, तर हाच पदार्थ दिसेल.',
      'Choose a meal category first, then select one dish.': 'प्रथम जेवणाचा प्रकार निवडा, नंतर एक पदार्थ निवडा.',
      'Choose one dish below. This exact choice is sent to the crew.': 'खालीलपैकी एक पदार्थ निवडा. हीच निवड क्रूला पाठवली जाईल.',
      'Specific dish choices are not configured for this category yet.': 'या प्रकारासाठी विशिष्ट पदार्थांचे पर्याय अद्याप उपलब्ध नाहीत.',
      'Please select one specific dish before saving your meal.': 'जेवण जतन करण्यापूर्वी एक विशिष्ट पदार्थ निवडा.',
      'Select one specific dish': 'एक विशिष्ट पदार्थ निवडा', 'Select a meal and a specific dish': 'जेवणाचा प्रकार आणि विशिष्ट पदार्थ निवडा',
      'Select one dish below': 'खालीलपैकी एक पदार्थ निवडा', 'Selected:': 'निवडलेले:'
    },
    te: {
      'Short note for crew (optional)': 'క్రూ కోసం చిన్న గమనిక (ఐచ్ఛికం)',
      "This note appears as an alert in the crew's Live Activity.": 'ఈ గమనిక క్రూ Live Activityలో అలర్ట్\u200cగా కనిపిస్తుంది.',
      'Keep it brief (160 characters max).': 'చిన్నగా ఉంచండి (గరిష్ఠంగా 160 అక్షరాలు).',
      'MEAL CHOSEN': 'భోజనం ఎంచుకున్నారు',
      'MEAL NOT CHOSEN': 'భోజనం ఎంచుకోలేదు',
      'STEP 2 · SPECIFIC DISH': 'దశ 2 · నిర్దిష్ట వంటకం', 'Choose the dish you want': 'మీకు కావలసిన వంటకాన్ని ఎంచుకోండి',
      'The crew dashboard and any late-change request will use this exact dish, not just the meal category.': 'క్రూ డ్యాష్‌బోర్డ్ మరియు చివరి మార్పు అభ్యర్థనలో భోజన వర్గం మాత్రమే కాకుండా ఈ వంటకం కనిపిస్తుంది.',
      'Choose a meal category first, then select one dish.': 'ముందుగా భోజన వర్గాన్ని ఎంచుకుని, తరువాత ఒక వంటకాన్ని ఎంచుకోండి.',
      'Choose one dish below. This exact choice is sent to the crew.': 'క్రింద ఒక వంటకాన్ని ఎంచుకోండి. ఈ ఎంపిక క్రూకు పంపబడుతుంది.',
      'Specific dish choices are not configured for this category yet.': 'ఈ వర్గానికి నిర్దిష్ట వంటకాల ఎంపికలు ఇంకా లేవు.',
      'Please select one specific dish before saving your meal.': 'భోజనాన్ని సేవ్ చేయడానికి ముందు ఒక నిర్దిష్ట వంటకాన్ని ఎంచుకోండి.',
      'Select one specific dish': 'ఒక నిర్దిష్ట వంటకాన్ని ఎంచుకోండి', 'Select a meal and a specific dish': 'భోజన వర్గం మరియు నిర్దిష్ట వంటకాన్ని ఎంచుకోండి',
      'Select one dish below': 'క్రింద ఒక వంటకాన్ని ఎంచుకోండి', 'Selected:': 'ఎంచుకున్నది:'
    },
    ta: {
      'Short note for crew (optional)': 'குழுவுக்கான குறிப்பு (விருப்பம்)',
      "This note appears as an alert in the crew's Live Activity.": 'இந்தக் குறிப்பு குழுவின் Live Activity-யில் எச்சரிக்கையாகத் தோன்றும்.',
      'Keep it brief (160 characters max).': 'சுருக்கமாக எழுதவும் (அதிகபட்சம் 160 எழுத்துகள்).',
      'MEAL CHOSEN': 'உணவு தேர்ந்தெடுக்கப்பட்டது',
      'MEAL NOT CHOSEN': 'உணவு தேர்ந்தெடுக்கப்படவில்லை',
      'STEP 2 · SPECIFIC DISH': 'படி 2 · குறிப்பிட்ட உணவு', 'Choose the dish you want': 'உங்களுக்கு விருப்பமான உணவைத் தேர்ந்தெடுக்கவும்',
      'The crew dashboard and any late-change request will use this exact dish, not just the meal category.': 'குழு டாஷ்போர்டிலும் தாமதமான மாற்றக் கோரிக்கையிலும் உணவு வகை மட்டுமல்ல, இந்த குறிப்பிட்ட உணவும் காட்டப்படும்.',
      'Choose a meal category first, then select one dish.': 'முதலில் உணவு வகையைத் தேர்ந்தெடுத்து, பின்னர் ஒரு உணவைத் தேர்ந்தெடுக்கவும்.',
      'Choose one dish below. This exact choice is sent to the crew.': 'கீழே ஒரு உணவைத் தேர்ந்தெடுக்கவும். இந்தத் தேர்வு குழுவுக்கு அனுப்பப்படும்.',
      'Specific dish choices are not configured for this category yet.': 'இந்த வகைக்கு குறிப்பிட்ட உணவுத் தேர்வுகள் இன்னும் அமைக்கப்படவில்லை.',
      'Please select one specific dish before saving your meal.': 'உணவைச் சேமிப்பதற்கு முன் ஒரு குறிப்பிட்ட உணவைத் தேர்ந்தெடுக்கவும்.',
      'Select one specific dish': 'ஒரு குறிப்பிட்ட உணவைத் தேர்ந்தெடுக்கவும்', 'Select a meal and a specific dish': 'உணவு வகையையும் குறிப்பிட்ட உணவையும் தேர்ந்தெடுக்கவும்',
      'Select one dish below': 'கீழே ஒரு உணவைத் தேர்ந்தெடுக்கவும்', 'Selected:': 'தேர்ந்தெடுக்கப்பட்டது:'
    },
    ja: {
      'Short note for crew (optional)': '乗務員への短いメモ（任意）',
      "This note appears as an alert in the crew's Live Activity.": 'このメモは乗務員のライブアクティビティにアラートとして表示されます。',
      'Keep it brief (160 characters max).': '160文字以内で簡潔に入力してください。',
      'MEAL CHOSEN': '食事選択済み',
      'MEAL NOT CHOSEN': '食事未選択',
      'STEP 2 · SPECIFIC DISH': 'ステップ2 · 具体的な料理', 'Choose the dish you want': '希望する料理を選択してください',
      'The crew dashboard and any late-change request will use this exact dish, not just the meal category.': '乗務員画面と直前変更リクエストには、食事カテゴリだけでなく選択した料理が表示されます。',
      'Choose a meal category first, then select one dish.': 'まず食事カテゴリを選び、次に料理を1つ選択してください。',
      'Choose one dish below. This exact choice is sent to the crew.': '下から料理を1つ選択してください。この選択が乗務員に送信されます。',
      'Specific dish choices are not configured for this category yet.': 'このカテゴリの料理選択はまだ設定されていません。',
      'Please select one specific dish before saving your meal.': '食事を保存する前に料理を1つ選択してください。',
      'Select one specific dish': '具体的な料理を1つ選択', 'Select a meal and a specific dish': '食事カテゴリと具体的な料理を選択',
      'Select one dish below': '下から料理を1つ選択', 'Selected:': '選択済み:'
    }
  };

  function pwTranslate(language) {
    const pwDictionary = {...(pwTranslations[language] || {}), ...(pwMealTranslations[language] || {}), ...(pwPickerTextTranslations[language] || {})};
    const pwRoots = [document.querySelector('main'), document.querySelector('#picker')].filter(Boolean);
    pwRoots.forEach(pwRootNode => {
      const pwWalker = document.createTreeWalker(pwRootNode, NodeFilter.SHOW_TEXT);
      let pwNode;
      while ((pwNode = pwWalker.nextNode())) {
        if (!pwOriginalText.has(pwNode)) pwOriginalText.set(pwNode, pwNode.nodeValue);
        const pwOriginal = pwOriginalText.get(pwNode);
        const pwKey = pwOriginal.trim();
        if (!pwKey) continue;
        const pwTranslated = pwDictionary[pwKey];
        if (pwTranslated) {
          const pwLeading = pwOriginal.match(/^\s*/)[0];
          const pwTrailing = pwOriginal.match(/\s*$/)[0];
          pwNode.nodeValue = pwLeading + pwTranslated + pwTrailing;
        } else {
          pwNode.nodeValue = pwOriginal;
        }
      }
    });
    // Navigation and the language control are outside <main>.
    document.querySelectorAll('.topbar nav a, .pw-language-label').forEach((pwElement) => {
      if (!pwOriginalText.has(pwElement)) pwOriginalText.set(pwElement, pwElement.textContent);
      const pwOriginal = pwOriginalText.get(pwElement).trim();
      pwElement.textContent = (pwDictionary[pwOriginal] || pwOriginal);
    });
    document.documentElement.lang = ({hi:'hi',bn:'bn',mr:'mr',te:'te',ta:'ta',ja:'ja',en:'en'})[language] || 'en';
    document.dispatchEvent(new CustomEvent('skybite:languagechange', {detail: {language: document.documentElement.lang}}));
  }

  async function pwSaveLanguage(language) {
    pwStatus.textContent = 'Saving…';
    try {
      const pwBody = new URLSearchParams({language, csrf_token: pwCsrf.value});
      const pwResponse = await fetch(pwRoot.dataset.pwSaveUrl, {
        method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
        body: pwBody.toString(), credentials: 'same-origin'
      });
      if (!pwResponse.ok) throw new Error('save failed');
      pwStatus.textContent = 'Saved';
    } catch (_pwError) {
      pwStatus.textContent = 'Saved for this view';
    }
  }

  const pwSavedLanguage = pwInitial.value || 'en';
  pwSelect.value = pwSavedLanguage;
  pwTranslate(pwSavedLanguage);
  const notePlaceholder = {
    en: 'e.g. Please keep the chutney separate',
    hi: 'जैसे: चटनी अलग रखें',
    bn: 'যেমন: চাটনি আলাদা রাখুন',
    mr: 'उदा. चटणी वेगळी ठेवा',
    te: 'ఉదా: చట్నీని వేరుగా ఉంచండి',
    ta: 'எ.கா. சட்னியைத் தனியாக வைக்கவும்',
    ja: '例：チャツネは別にしてください'
  };
  const noteField = document.querySelector('#passenger-note');
  const updateNotePlaceholder = language => { if (noteField) noteField.placeholder = notePlaceholder[language] || notePlaceholder.en; };
  updateNotePlaceholder(pwSavedLanguage);
  pwSelect.addEventListener('change', () => {
    pwTranslate(pwSelect.value);
    updateNotePlaceholder(pwSelect.value);
    pwSaveLanguage(pwSelect.value);
  });



  // Meal preference filters: every meal from the database remains available in the picker.
  // Filters are presentation-only; the existing meal_code form submission is unchanged.
  const pwPicker = document.querySelector('#picker');
  const pwPickerGrid = pwPicker?.querySelector('.picker-grid');
  if (pwPicker && pwPickerGrid && !pwPicker.querySelector('.pw-preference-filters')) {
    const pwFilterGroups = [
      { id: 'all', label: 'All preferences', codes: [] },
      { id: 'fasting', label: 'Fasting & festivals', codes: ['navratri','ekadashi','ramzan'] },
      { id: 'religious', label: 'Religious & cultural', codes: ['jain','sattvik','halal'] },
      { id: 'everyday', label: 'Everyday meals', codes: ['veg','nonveg','child'] },
      { id: 'health', label: 'Health preferences', codes: ['diabetic','lowsodium'] },
      { id: 'allergy', label: 'Allergies & special diets', codes: ['nutfree','gluten'] }
    ];
    const pwFilterLabels = {
      hi: ['सभी पसंद','व्रत और त्योहार','धार्मिक और सांस्कृतिक','रोज़मर्रा के भोजन','स्वास्थ्य संबंधी पसंद','एलर्जी और विशेष आहार'],
      bn: ['সব পছন্দ','উপবাস ও উৎসব','ধর্মীয় ও সাংস্কৃতিক','দৈনন্দিন খাবার','স্বাস্থ্যগত পছন্দ','অ্যালার্জি ও বিশেষ খাদ্য'],
      mr: ['सर्व पसंती','उपवास आणि सण','धार्मिक आणि सांस्कृतिक','रोजचे जेवण','आरोग्यविषयक पसंती','अॅलर्जी आणि विशेष आहार'],
      te: ['అన్ని అభిరుచులు','ఉపవాసం & పండుగలు','మతపరమైన & సాంస్కృతిక','రోజువారీ భోజనం','ఆరోగ్య అభిరుచులు','అలర్జీలు & ప్రత్యేక ఆహారం'],
      ta: ['அனைத்து விருப்பங்கள்','விரதம் & பண்டிகைகள்','மதம் & கலாச்சாரம்','அன்றாட உணவுகள்','உடல்நல விருப்பங்கள்','ஒவ்வாமை & சிறப்பு உணவுகள்'],
      ja: ['すべての好み','断食・祝祭','宗教・文化','日常の食事','健康上の希望','アレルギー・特別食'],
      en: pwFilterGroups.map(g => g.label)
    };
    const pwFilters = document.createElement('div');
    pwFilters.className = 'pw-preference-filters';
    pwFilters.setAttribute('role', 'group');
    pwFilters.setAttribute('aria-label', 'Filter meal preferences');
    pwFilterGroups.forEach((group, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pw-preference-filter' + (i === 0 ? ' is-active' : '');
      button.dataset.pwFilter = group.id;
      button.textContent = group.label;
      button.addEventListener('click', () => {
        pwFilters.querySelectorAll('button').forEach(b => {
          const active = b === button;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        pwPickerGrid.querySelectorAll('.tile').forEach(tile => {
          const code = tile.querySelector('input[name="meal_code"]')?.value || '';
          tile.hidden = group.id !== 'all' && !group.codes.includes(code);
        });
      });
      button.setAttribute('aria-pressed', String(i === 0));
      pwFilters.appendChild(button);
    });
    pwPickerGrid.parentNode.insertBefore(pwFilters, pwPickerGrid);
    const pwUpdateFilterLanguage = language => {
      const labels = pwFilterLabels[language] || pwFilterLabels.en;
      pwFilters.querySelectorAll('button').forEach((button, i) => { button.textContent = labels[i]; });
    };
    pwSelect.addEventListener('change', () => pwUpdateFilterLanguage(pwSelect.value));
    pwPicker.addEventListener('close', () => {
      pwFilters.querySelector('[data-pw-filter="all"]')?.click();
    });
    pwUpdateFilterLanguage(pwSelect.value || 'en');
  }
})();
