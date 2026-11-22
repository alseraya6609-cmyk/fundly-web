/*
  ترجمات نصوص خاصة بالموقع ليست في قواميس التطبيق. كل ما يوجد في التطبيق
  يُؤخذ من قواميسه (scripts/gen-i18n.mjs) ولا يُكرَّر هنا.
*/
type Row = [ar: string, en: string, fr: string, ur: string, zh: string]

const rows: Row[] = [
  ['أدخل البريد الإلكتروني أو الرقم التعريفي أو رقم الهاتف', 'Enter your email, ID number or phone number', 'Saisissez votre e-mail, numéro d’identification ou téléphone', 'ای میل، شناختی نمبر یا فون نمبر درج کریں', '请输入电子邮箱、识别号或电话号码'],
  ['إدارة ومتابعة الالتزامات المالية مع الآخرين', 'Manage and track financial commitments with others', 'Gérez et suivez vos engagements financiers avec les autres', 'دوسروں کے ساتھ مالی وابستگیوں کا انتظام اور پیروی', '管理并跟踪与他人的财务承诺'],
  ['إصدار الموقع', 'Website version', 'Version du site', 'ویب سائٹ ورژن', '网站版本'],
  ['إنشاء الحساب واستعادة كلمة المرور من التطبيق.', 'Sign-up and password recovery are done in the app.', 'La création de compte et la récupération du mot de passe se font dans l’application.', 'اکاؤنٹ بنانا اور پاس ورڈ بحال کرنا ایپ سے ہوتا ہے۔', '注册账户和找回密码请在应用中进行。'],
  ['ادخل بحساب التطبيق نفسه', 'Sign in with your app account', 'Connectez-vous avec votre compte de l’application', 'ایپ والے اکاؤنٹ سے لاگ اِن کریں', '使用应用账户登录'],
  ['ادخل بحساب التطبيق نفسه لتطّلع على بياناتك من الحاسوب.', 'Sign in with your app account to view your data from a computer.', 'Connectez-vous avec votre compte de l’application pour consulter vos données depuis un ordinateur.', 'کمپیوٹر سے اپنا ڈیٹا دیکھنے کے لیے ایپ والے اکاؤنٹ سے لاگ اِن کریں۔', '使用应用账户登录，即可在电脑上查看您的数据。'],
  ['الإضافة والتعديل والطلبات والإشعارات من التطبيق. الموقع يعرض بياناتك في هذه المرحلة.', 'Adding, editing, requests and notifications are in the app. At this stage the website displays your data.', 'L’ajout, la modification, les demandes et les notifications se font dans l’application. À ce stade, le site affiche vos données.', 'شامل کرنا، ترمیم، درخواستیں اور اطلاعات ایپ میں ہیں۔ اس مرحلے پر ویب سائٹ آپ کا ڈیٹا دکھاتی ہے۔', '添加、编辑、请求和通知请在应用中操作。现阶段网站用于查看您的数据。'],
  ['البريد الإلكتروني أو الرقم التعريفي أو رقم الهاتف', 'Email, ID number or phone number', 'E-mail, numéro d’identification ou téléphone', 'ای میل، شناختی نمبر یا فون نمبر', '电子邮箱、识别号或电话号码'],
  ['البريد غير مفعّل بعد — فعّله من التطبيق أولًا', 'Email not verified yet — verify it in the app first', 'E-mail non vérifié — vérifiez-le d’abord dans l’application', 'ای میل ابھی تصدیق شدہ نہیں — پہلے ایپ سے تصدیق کریں', '邮箱尚未验证——请先在应用中验证'],
  ['التطبيق', 'The app', 'L’application', 'ایپ', '应用'],
  ['التعديل والإضافة من التطبيق حاليًا. الموقع للعرض في هذه المرحلة.', 'Editing and adding are done in the app for now. The website is view-only at this stage.', 'La modification et l’ajout se font pour l’instant dans l’application. Le site est en lecture seule à ce stade.', 'فی الحال ترمیم اور اضافہ ایپ سے ہوتا ہے۔ اس مرحلے پر ویب سائٹ صرف دیکھنے کے لیے ہے۔', '目前请在应用中编辑和添加。现阶段网站仅供查看。'],
  ['السجلات', 'Records', 'Enregistrements', 'ریکارڈز', '记录'],
  ['الصفحة غير موجودة', 'Page not found', 'Page introuvable', 'صفحہ نہیں ملا', '页面不存在'],
  ['تاريخ الإضافة', 'Date added', 'Date d’ajout', 'شامل کرنے کی تاریخ', '添加日期'],
  ['تحديث سياسة الخصوصية وشروط الاستخدام', 'Privacy Policy and Terms of Use update', 'Mise à jour de la politique de confidentialité et des conditions d’utilisation', 'رازداری کی پالیسی اور شرائطِ استعمال کی تازہ کاری', '隐私政策和使用条款更新'],
  ['تعذّر تحميل البيانات', 'Could not load data', 'Impossible de charger les données', 'ڈیٹا لوڈ نہیں ہو سکا', '无法加载数据'],
  ['حسابك موقوف', 'Your account is suspended', 'Votre compte est suspendu', 'آپ کا اکاؤنٹ معطل ہے', '您的账户已被暂停'],
  ['روابط', 'Links', 'Liens', 'روابط', '链接'],
  ['سجل الأفراد والجهات ومستنداتهم والتزاماتهم', 'Register of people and entities, their documents and commitments', 'Registre des personnes et entités, de leurs documents et engagements', 'افراد اور اداروں، ان کی دستاویزات اور وابستگیوں کا ریکارڈ', '个人与机构及其文件和承诺的登记'],
  ['طلبات جديدة', 'New requests', 'Nouvelles demandes', 'نئی درخواستیں', '新请求'],
  ['صفحة الالتزامات الشخصية', 'Personal commitments page', 'Page des engagements personnels', 'ذاتی وابستگیوں کا صفحہ', '个人承诺页面'],
  ['للاستفسار تواصل مع الدعم', 'For inquiries, contact support', 'Pour toute question, contactez le support', 'استفسار کے لیے سپورٹ سے رابطہ کریں', '如有疑问，请联系支持团队'],
  ['للرد على الطلبات وقبولها افتح التطبيق.', 'Open the app to reply to and accept requests.', 'Ouvrez l’application pour répondre aux demandes et les accepter.', 'درخواستوں کا جواب دینے اور قبول کرنے کے لیے ایپ کھولیں۔', '请打开应用回复和接受请求。'],
  ['للمتابعة اقرأ السياسة والشروط ووافق عليها.', 'To continue, read and accept the policy and terms.', 'Pour continuer, lisez et acceptez la politique et les conditions.', 'جاری رکھنے کے لیے پالیسی اور شرائط پڑھیں اور منظور کریں۔', '如需继续，请阅读并同意政策和条款。'],
  ['مخفية في الموقع', 'Hidden on the website', 'Masqué sur le site', 'ویب سائٹ پر پوشیدہ', '网站中已隐藏'],
  ['مستحق عليك', 'You owe', 'Vous devez', 'آپ کے ذمے', '您应付'],
  ['مستحق لك', 'Owed to you', 'On vous doit', 'آپ کا واجب الادا', '应付给您'],
  ['من إدارة فوندلي', 'From Fundly management', 'De la part de l’équipe Fundly', 'فنڈلی انتظامیہ کی جانب سے', '来自 Fundly 管理团队'],
  ['نعمل على تحسين الخدمة، وسنعود قريبًا.', 'We are improving the service and will be back soon.', 'Nous améliorons le service et serons bientôt de retour.', 'ہم سروس بہتر بنا رہے ہیں اور جلد واپس آئیں گے۔', '我们正在改进服务，很快回来。'],
]

const langs = ['en', 'fr', 'ur', 'zh'] as const

export const extra: Partial<Record<(typeof langs)[number], Record<string, string>>> = Object.fromEntries(
  langs.map((lang, i) => [lang, Object.fromEntries(rows.map((row) => [row[0], row[i + 1]]))]),
)
