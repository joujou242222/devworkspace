/**
 * DevWorkspace Full Arabic (RTL) / English Translation Engine
 * - Instant lossless toggle between English (LTR) and Arabic (RTL)
 * - Persisted in localStorage ('devworkspace_lang')
 * - Strictly preserves all numbers (0-9) as standard numerals per user requirement
 * - Multi-layer translation: Exact phrases, regex patterns with dynamic parameters,
 *   date/relative time formatting, and substring tokenization
 * - Continuous MutationObserver for dynamically loaded API content and dialogs
 */

const STORAGE_KEY = 'devworkspace_lang';

// Days of week mapping (numbers remain digits)
const DAYS_MAP = {
  'Mon': 'الإثنين', 'Monday': 'الإثنين',
  'Tue': 'الثلاثاء', 'Tuesday': 'الثلاثاء',
  'Wed': 'الأربعاء', 'Wednesday': 'الأربعاء',
  'Thu': 'الخميس', 'Thursday': 'الخميس',
  'Fri': 'الجمعة', 'Friday': 'الجمعة',
  'Sat': 'السبت', 'Saturday': 'السبت',
  'Sun': 'الأحد', 'Sunday': 'الأحد'
};

// Months mapping
const MONTHS_MAP = {
  'Jan': 'يناير', 'January': 'يناير',
  'Feb': 'فبراير', 'February': 'فبراير',
  'Mar': 'مارس', 'March': 'مارس',
  'Apr': 'أبريل', 'April': 'أبريل',
  'May': 'مايو',
  'Jun': 'يونيو', 'June': 'يونيو',
  'Jul': 'يوليو', 'July': 'يوليو',
  'Aug': 'أغسطس', 'August': 'أغسطس',
  'Sep': 'سبتمبر', 'September': 'سبتمبر',
  'Oct': 'أكتوبر', 'October': 'أكتوبر',
  'Nov': 'نوفمبر', 'November': 'نوفمبر',
  'Dec': 'ديسمبر', 'December': 'ديسمبر'
};

export const PHRASE_DICTIONARY = {
  // === Navigation & Shell ===
  'Devworkspace': 'ديف ورك سبيس',
  'Plan projects on one timeline': 'تخطيط المشاريع على جدول زمني موحد',
  'Dashboard': 'لوحة التحكم',
  'Projects': 'المشاريع',
  'Project': 'المشروع',
  'Clients': 'العملاء',
  'Client': 'العميل',
  'Tasks': 'المهام',
  'Task': 'المهمة',
  'Milestones': 'المعالم الرئيسية',
  'Milestone': 'المَعلم الرئيسي',
  'Deliverables': 'المخرجات',
  'Deliverable': 'المُخرَج',
  'Documents': 'المستندات',
  'Document': 'المستند',
  'Reviews': 'المراجعات',
  'Review': 'المراجعة',
  'Comments': 'التعليقات',
  'Comment': 'التعليق',
  'Notes': 'الملاحظات',
  'Note': 'الملاحظة',
  'Team': 'فريق العمل',
  'Settings': 'الإعدادات',
  'Account': 'الحساب',
  'My tasks': 'مهامي',
  'My Tasks': 'مهامي',
  'Notifications': 'الإشعارات',
  'Documents': 'المستندات',
  'Reviews': 'المراجعات',
  'Review center': 'مركز المراجعة',
  'Reports': 'التقارير',
  'Audit': 'سجل التدقيق',
  'Audit log': 'سجل التدقيق',
  'Audit Trail': 'سجل الامتثال والتدقيق',
  'Log out': 'تسجيل الخروج',
  'Sign in': 'تسجيل الدخول',
  'Sign out': 'تسجيل الخروج',
  'Create account': 'إنشاء حساب',
  'Create an account': 'إنشاء حساب جديد',
  'New here?': 'مستخدم جديد؟',
  'Search': 'بحث',
  'Search…': 'بحث…',
  'Search projects, tasks, files…': 'البحث في المشاريع والمهام والملفات…',
  'Search projects, tasks…': 'البحث في المشاريع والمهام…',
  'Filter': 'تصفية',
  'Filter…': 'تصفية…',
  'All': 'الكل',
  'Active': 'نشط',
  'Planned': 'مخطط',
  'Archived': 'مؤرشف',
  'Completed': 'مكتمل',
  'Current': 'الحالي',
  'List': 'قائمة',
  'Grid': 'شبكة',
  'Board': 'لوحة',
  'Status': 'الحالة',
  'Actions': 'الإجراءات',
  'Date': 'التاريخ',
  'Due': 'الاستحقاق',
  'Due date': 'تاريخ الاستحقاق',
  'Priority': 'الأولوية',
  'Assignee': 'المُكلَّف',
  'Role': 'الصلاحية / الدور',
  'Save changes': 'حفظ التغييرات',
  'Saving…': 'جاري الحفظ…',
  'Saved': 'تم الحفظ',
  'Cancel': 'إلغاء',
  'Delete': 'حذف',
  'Edit': 'تعديل',
  'Create': 'إنشاء',
  'Add': 'إضافة',
  'Upload': 'رفع ملف',
  'Download': 'تحميل',
  'Close': 'إغلاق',
  'Back': 'رجوع',
  'Next': 'التالي',
  'View': 'طريقة العرض',
  'View all': 'عرض الكل',
  'Show': 'عرض',
  'Preferences': 'التفضيلات',
  'Loading…': 'جاري التحميل…',
  'Refresh': 'تحديث',
  'Confirm': 'تأكيد',
  'Collapse sidebar': 'طي الشريط الجانبي',
  'Expand sidebar': 'توسيع الشريط الجانبي',
  'Start a project': 'بدء مشروع',
  'This project is not available.': 'هذا المشروع غير متاح.',
  'Internal only. Clients never see these.': 'للاستخدام الداخلي فقط. لا يمكن للعملاء رؤية هذه المستندات.',
  'Try clearing a filter.': 'جرّب مسح خيارات التصفية لرؤية المزيد.',
  'Last edited': 'آخر تعديل',
  'By': 'بواسطة',
  'Create document': 'إنشاء المستند',
  'Packaging refresh': 'تحديث تصاميم التغليف',

  // === Authentication & Onboarding ===
  'Use the email you registered with.': 'استخدم البريد الإلكتروني الذي سجلت به.',
  'Email': 'البريد الإلكتروني',
  'Password': 'كلمة المرور',
  'Forgot your password?': 'نسيت كلمة المرور؟',
  'Reset password': 'إعادة تعيين كلمة المرور',
  'Quick Demo Account': 'حساب العرض التجريبي السريع',
  'Auto-fill': 'ملء تلقائي',
  'Signing in…': 'جاري الدخول…',
  'Full name': 'الاسم الكامل',
  'Confirm password': 'تأكيد كلمة المرور',
  'Pick up where the timeline left off.': 'تابع العمل من حيث توقف الجدول الزمني.',
  'Your projects, reviews and clients are exactly as you left them.': 'مشاريعك ومراجعاتك وعملاؤك في انتظارك تماماً كما تركتهم.',
  'Start your 14-day free trial.': 'ابدأ تجربتك المجانية لمدة 14 يوماً.',
  'No credit card required.': 'لا يلزم إدخال بطاقة ائتمان.',
  'Set up your organization': 'تهيئة منظمتك ومساحة عملك',
  'Organization name': 'اسم المنظمة / الوكالة',
  'Organization description': 'وصف المنظمة',
  'Complete setup': 'إكمال الإعداد والبدء',
  'Invitation': 'دعوة انضمام',
  'Accept invitation': 'قبول الدعوة',

  // === Workspace Dashboard ===
  'Good morning': 'صباح الخير',
  'Good afternoon': 'مساء الخير',
  'Good evening': 'مساء الخير',
  'Your Projects': 'مشاريعك الحالية',
  'Your projects': 'مشاريعك الحالية',
  'Your Tasks': 'مهامك الموكلة',
  'Your tasks': 'مهامك الموكلة',
  'Waiting on a Decision': 'بانتظار اتخاذ قرار',
  'Waiting on a decision': 'بانتظار اتخاذ قرار',
  'Latest Activity': 'آخر الأنشطة والفعاليات',
  'Latest activity': 'آخر الأنشطة والفعاليات',
  'Upcoming milestones': 'المعالم الرئيسية القادمة',
  'Delivery throughput': 'معدل إنجاز التسليمات',
  'Active projects': 'المشاريع النشطة',
  'Reviews pending': 'مراجعات معلقة',
  'Tasks assigned to you': 'مهام مخصصة لك',

  // === Empty States Across Entire SaaS ===
  'No tasks assigned to you right now.': 'لا توجد مهام مخصصة لك في الوقت الحالي.',
  'No tasks assigned to you': 'لا توجد مهام مخصصة لك',
  'No active projects yet.': 'لا توجد مشاريع نشطة بعد.',
  'No projects for this client yet.': 'لا توجد مشاريع لهذا العميل بعد.',
  'No contacts available to assign.': 'لا توجد جهات اتصال متاحة للتعيين.',
  'No reviews currently awaiting decision.': 'لا توجد مراجعات بانتظار اتخاذ قرار حالياً.',
  'No recent activity recorded yet.': 'لم يتم تسجيل أي أنشطة حديثة بعد.',
  'No upcoming milestones': 'لا توجد معالم رئيسية قادمة',
  'No document selected': 'لم يتم تحديد أي مستند',
  'No documents match': 'لا توجد مستندات مطابقة',
  'No documents yet': 'لا توجد مستندات بعد',
  'No active projects available': 'لا توجد مشاريع نشطة متاحة',
  'No organization selected.': 'لم يتم تحديد منظمة.',
  'No clients found': 'لم يتم العثور على أي عملاء',
  'No clients available': 'لا يوجد عملاء متاحون',
  'No active members': 'لا يوجد أعضاء نشطون',
  'No projects match': 'لا توجد مشاريع مطابقة',
  'No clients yet': 'لا يوجد عملاء بعد',
  'No projects yet': 'لا توجد مشاريع بعد',
  'No notifications': 'لا توجد إشعارات',
  'No shared files yet': 'لا توجد ملفات مشتركة بعد',
  'No updates posted yet': 'لم يتم نشر أي تحديثات بعد',
  'No review available.': 'لا توجد مراجعة متاحة.',
  'No comments yet.': 'لا توجد تعليقات بعد.',
  'Click anywhere on the preview to add a pin.': 'انقر في أي مكان على المعاينة لإضافة علامة ملاحظة.',
  'No review cycle found for this project.': 'لم يتم العثور على دورة مراجعة لهذا المشروع.',
  'No project selected.': 'لم يتم تحديد أي مشروع.',
  'You\'re all caught up': 'لقد اطلعت على جميع الإشعارات',
  'No read notifications': 'لا توجد إشعارات مقروءة',
  'No unread notifications': 'لا توجد إشعارات غير مقروءة',

  // === Projects & Tasks (LaunchFlow) ===
  'Project Overview': 'نظرة عامة على المشروع',
  'Overview': 'نظرة عامة',
  'Tasks': 'المهام',
  'Milestones': 'المعالم الرئيسية',
  'Files': 'الملفات والمرفقات',
  'Deliverables': 'المخرجات والنسخ',
  'Team & access': 'الفريق والصلاحيات',
  'Discussions': 'النقاشات الداخلية',
  'Activity': 'سجل النشاط',
  'New project': 'مشروع جديد',
  'New Project': 'مشروع جديد',
  'Create project': 'إنشاء مشروع',
  'Create Project': 'إنشاء مشروع',
  'Project name': 'اسم المشروع',
  'Project manager': 'مدير المشروع',
  'Delivery date': 'تاريخ التسليم',
  'Everything in flight, and what’s next.': 'كل ما هو قيد التنفيذ، والخطوات التالية.',
  'Client': 'العميل',
  'Select client': 'اختر العميل',
  'Enable client portal': 'تفعيل بوابة العميل',
  'Project health': 'حالة المشروع',
  'On track': 'تسير وفق الخطة',
  'At risk': 'تحت الملاحظة',
  'Delayed': 'متأخرة',
  'New task': 'مهمة جديدة',
  'New Task': 'مهمة جديدة',
  'Create task': 'إنشاء المهمة',
  'Add task': 'إضافة مهمة',
  'Task title': 'عنوان المهمة',
  'Title': 'العنوان',
  'Description': 'الوصف',
  'Milestone': 'المَعلم',
  'Assign to': 'تعيين إلى',
  'Unassigned': 'غير معين',
  'Any time': 'أي وقت',
  'This week': 'هذا الأسبوع',
  'Checklist': 'قائمة التحقق',
  'one item per line': 'عنصر واحد في كل سطر',
  'Add item': 'إضافة عنصر',
  'Add item…': 'إضافة عنصر…',
  'Add checklist item': 'إضافة عنصر لقائمة التحقق',
  'Internal comments': 'التعليقات الداخلية',
  'Post comment': 'نشر تعليق',
  'Write a comment…': 'اكتب تعليقاً…',
  'New milestone': 'مَعلم رئيسي جديد',
  'New Milestone': 'مَعلم رئيسي جديد',
  'Milestone title': 'عنوان المَعلم',
  'Target date': 'التاريخ المستهدف',
  'Open': 'مفتوح',
  'To do': 'قيد الانتظار',
  'In progress': 'قيد التنفيذ',
  'In review': 'قيد المراجعة',
  'Done': 'مكتمل',
  'High': 'عالي',
  'Medium': 'متوسط',
  'Low': 'منخفض',
  'Urgent': 'عاجل',
  'No tasks match': 'لا توجد مهام مطابقة',
  'Clear a filter to see more.': 'امسح التصفية لرؤية المزيد.',
  'This data changed.': 'تم تحديث هذه البيانات.',
  'This project changed while you were editing. Reload to see the latest version.': 'تم تعديل هذا المشروع أثناء التحرير. أعد التحميل لرؤية أحدث نسخة.',

  // === Reviews & Proofly ===
  'New Deliverable': 'مُخرَج جديد',
  'New deliverable': 'مُخرَج جديد',
  'Create Deliverable': 'إنشاء مُخرَج',
  'Deliverable title': 'عنوان المُخرَج',
  'Upload file': 'رفع ملف للتدقيق',
  'Deliverable': 'المُخرَج',
  'Version': 'النسخة',
  'Versions': 'النسخ والإصدارات',
  'Version under review': 'النسخة قيد المراجعة',
  'Cycle': 'الدورة',
  'Review cycle': 'دورة المراجعة',
  'Start review cycle': 'بدء دورة المراجعة',
  'Changes Requested': 'مطلوب إجراء تعديلات',
  'Changes requested': 'مطلوب إجراء تعديلات',
  'Approve deliverable': 'اعتماد وموافقة على المُخرَج',
  'Request changes': 'طلب تعديلات من الفريق',
  'Decision': 'القرار',
  'Decision log': 'سجل القرارات',
  'Formal review decision': 'القرار الرسمي للمراجعة',
  'Decision notes': 'ملاحظات وتوجيهات القرار',
  'Record decision': 'تسجيل القرار الرسمي',
  'Pin annotations': 'علامات الملاحظات الموضعية',
  'Click canvas to add pin': 'انقر على اللوحة لإضافة علامة ملاحظة',
  'Convert to task': 'تحويل الملاحظة إلى مهمة',
  'Converted to task': 'تم التحويل لمهمة',
  'This review is closed. It’s read-only.': 'هذه المراجعة مغلقة. إنها للقراءة فقط.',
  'Preview isn’t available': 'المعاينة غير متاحة',
  'You can still read the comments.': 'لا يزال بإمكانك قراءة التعليقات.',
  'Comments': 'التعليقات',
  'Add a note': 'إضافة ملاحظة',
  'Add note': 'إضافة ملاحظة',
  'Approve': 'اعتماد',
  'Only the client’s decision-makers can approve': 'يمكن فقط لمعتمدي العميل الموافقة على النسخة',
  'Internal staff can’t approve. Only the client’s decision-makers can.': 'لا يمكن للموظفين الداخليين الاعتماد. فقط صناع القرار لدى العميل هم المخولون.',
  'Cancel or replace review': 'إلغاء المراجعة أو استبدالها',
  'You’re reviewing the version selected, not necessarily the newest.': 'أنت تراجع النسخة المحددة، وليس بالضرورة النسخة الأحدث.',
  'Cancel stops the review. Replace moves it to another version.': 'الإلغاء يوقف المراجعة. والاستبدال ينقلها إلى نسخة أخرى.',
  'Action': 'الإجراء',
  'Cancel review': 'إلغاء المراجعة',
  'Replace review': 'استبدال المراجعة',
  'Select newer version': 'اختر نسخة أحدث',

  // === OrbitSpace & Team ===
  'New client': 'عميل جديد',
  'New Client': 'عميل جديد',
  'Client name': 'اسم العميل / الشركة',
  'Primary contact': 'جهة الاتصال الرئيسية',
  'Contact email': 'بريد جهة الاتصال',
  'Phone': 'الهاتف',
  'New document': 'مستند جديد',
  'New Document': 'مستند جديد',
  'Document title': 'عنوان المستند',
  'Collaborative document': 'مستند تحرير تعاوني',
  'Invite member': 'دعوة عضو جديد',
  'Invite Member': 'دعوة عضو جديد',
  'Member email': 'بريد العضو المدعو',
  'Select role': 'تحديد الصلاحية',
  'Owner': 'مالك',
  'Manager': 'مدير مشاريع',
  'Member': 'عضو فريق',
  'Approver': 'معتمد رسمي',
  'Reviewer': 'مراجع',

  // === Client Portal ===
  'Client Portal': 'بوابة العميل الرسمية',
  'Client space': 'مساحة العميل',
  'Shared Deliverables': 'المخرجات المشتركة',
  'Project Milestones': 'معالم المشروع والجدول الزمني',
  'Company Updates': 'تحديثات المشروع والتقارير',
  'Latest updates': 'آخر التحديثات',
  'Sign in as Client': 'دخول بوابة العملاء',
  'Review & Approve': 'مراجعة واعتماد المخرجات',

  // === Settings & Audit ===
  'Organization Settings': 'إعدادات المنظمة والوكالة',
  'Branding': 'الهوية والشعار',
  'Upload logo': 'رفع الشعار الرسمي',
  'Timezone': 'المنطقة الزمنية',
  'Active Sessions': 'الجلسات والأجهزة النشطة',
  'Revoke session': 'إنهاء الجلسة',
  'Current session': 'الجلسة الحالية',
  'Notification Preferences': 'تفضيلات الإشعارات',
  'Compliance Audit Trail': 'سجل الامتثال والعمليات غير القابل للتعديل',
  'Timestamp': 'التوقيت',
  'Actor': 'المستخدم المنفذ',
  'Event': 'نوع العملية',
  'Details': 'التفاصيل',
  'IP Address': 'عنوان IP',

  // === Sample & Production Entity Names ===
  'OmniPay Design System & Brand Identity': 'نظام تصميم OmniPay والهوية البصرية',
  'Acme Global Ventures': 'مشاريع أكمي العالمية (Acme Global)',
  'Brand film': 'فيلم الهوية الإعلاني',
  'Spring campaign': 'حملة الربيع',
  'Spring poster': 'ملصق الربيع',
  'Nile Foods': 'نايل فودز',
  'Delta Retail': 'دلتا للتجزئة',
  'Studio internal': 'داخلي للاستوديو',
  'Script lock': 'اعتماد السيناريو',
  'Rough cut': 'النسخة الأولية',
  'Client review': 'مراجعة العميل',
  'Delivery': 'التسليم النهائي',
  'Write launch film script': 'كتابة سيناريو فيلم الإطلاق',
  'Prepare shoot call sheet': 'إعداد جدول مواعيد التصوير',
  'Export v3 for review': 'تصدير النسخة 3 للمراجعة',
  'Brand film cut': 'مونتاج فيلم الهوية',
  'Storyboard': 'لوحة القصة (ستوريبورد)',
  'Sara': 'سارة',
  'Sara Adel': 'سارة عادل',
  'Omar': 'عمر',
  'Omar Hassan': 'عمر حسن',
  'Layla Samir': 'ليلى سمير',

  // === Time & Relative Strings ===
  'Today': 'اليوم',
  'Yesterday': 'أمس',
  'Tomorrow': 'غداً',
  'Just now': 'الآن',
  'just now': 'الآن',
  'Overdue': 'متأخر',
  'days ago': 'أيام مضت',
  'hours ago': 'ساعات مضت',

  // === Switcher Controls ===
  'Language': 'اللغة',
  'Switch to Arabic': 'التحويل إلى العربية',
  'Switch to English': 'Switch to English',
  'English': 'English',
  'Arabic': 'العربية'
};

class I18nManager {
  constructor() {
    this.currentLang = 'en';
    this.observer = null;
    this.isTranslating = false;
    this.origTextMap = new WeakMap();
    this.origAttrMap = new WeakMap();
  }

  init() {
    if (typeof window === 'undefined') return;

    const saved = localStorage.getItem(STORAGE_KEY);
    this.currentLang = (saved === 'ar' || saved === 'en') ? saved : 'en';

    this.apply(this.currentLang, false);
    this.mountSwitcher();
    this.setupObserver();
  }

  getLang() {
    return this.currentLang;
  }

  isRTL() {
    return this.currentLang === 'ar';
  }

  setLang(lang) {
    if (lang !== 'ar' && lang !== 'en') return;
    this.currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    this.apply(lang, true);
    this.updateSwitcherUI();
  }

  toggle() {
    this.setLang(this.currentLang === 'ar' ? 'en' : 'ar');
  }

  /**
   * Main Translation Function
   * Strictly preserves all numbers (0-9) as standard numerals!
   */
  translateText(text) {
    if (!text || typeof text !== 'string') return text;
    const trimmed = text.trim();
    if (!trimmed) return text;

    // 1. Direct dictionary lookup (exact match)
    if (PHRASE_DICTIONARY[trimmed]) {
      return text.replace(trimmed, PHRASE_DICTIONARY[trimmed]);
    }

    let result = trimmed;

    // 2. Pattern Matchers with Parameter & Number Extraction
    // Numbers remain standard digits: e.g. "3 of 7 done" -> "3 من أصل 7 مكتملة"
    
    // Greeting with dynamic user name: "Good morning, Sara" -> "صباح الخير، سارة"
    if (/^Good (morning|afternoon|evening)(?:,\s*([^\s]+))?$/i.test(result)) {
      result = result.replace(/^Good (morning|afternoon|evening)(?:,\s*([^\s]+))?$/i, (_, time, name) => {
        const arabicTime = time.toLowerCase() === 'morning' ? 'صباح الخير' : 'مساء الخير';
        if (name) {
          const translatedName = PHRASE_DICTIONARY[name] || name;
          return `${arabicTime}، ${translatedName}`;
        }
        return arabicTime;
      });
      return text.replace(trimmed, result);
    }

    // Dashboard metrics banner:
    // "3 tasks due this week and 2 reviews waiting on a decision."
    if (/(\d+)\s+tasks?\s+due\s+this\s+week\s+and\s+(\d+)\s+reviews?\s+waiting\s+on\s+a\s+decision/i.test(result)) {
      result = result.replace(/(\d+)\s+tasks?\s+due\s+this\s+week\s+and\s+(\d+)\s+reviews?\s+waiting\s+on\s+a\s+decision/i, 
        '$1 مهام مستحقة هذا الأسبوع و $2 مراجعات بانتظار اتخاذ قرار');
      return text.replace(trimmed, result);
    }

    // "0 tasks on your list and 0 reviews waiting on a decision."
    if (/(\d+)\s+tasks?\s+on\s+your\s+list\s+and\s+(\d+)\s+reviews?\s+waiting\s+on\s+a\s+decision/i.test(result)) {
      result = result.replace(/(\d+)\s+tasks?\s+on\s+your\s+list\s+and\s+(\d+)\s+reviews?\s+waiting\s+on\s+a\s+decision/i,
        '$1 مهام في قائمتك و $2 مراجعات بانتظار اتخاذ قرار');
      return text.replace(trimmed, result);
    }

    // "X tasks due this week"
    if (/(\d+)\s+tasks?\s+due\s+this\s+week/i.test(result)) {
      result = result.replace(/(\d+)\s+tasks?\s+due\s+this\s+week/i, '$1 مهام مستحقة هذا الأسبوع');
    }

    // "X reviews waiting on a decision"
    if (/(\d+)\s+reviews?\s+waiting\s+on\s+a\s+decision/i.test(result)) {
      result = result.replace(/(\d+)\s+reviews?\s+waiting\s+on\s+a\s+decision/i, '$1 مراجعات بانتظار قرار');
    }

    // "X of Y done" / "X of Y completed"
    if (/(\d+)\s+of\s+(\d+)\s+(?:done|completed)/i.test(result)) {
      result = result.replace(/(\d+)\s+of\s+(\d+)\s+(?:done|completed)/i, '$1 من أصل $2 مكتملة');
    }

    // "Overdue Xd" -> "متأخر X يوم"
    if (/Overdue\s+(\d+)d/i.test(result)) {
      result = result.replace(/Overdue\s+(\d+)d/i, 'متأخر $1 يوم');
    }
    if (/Overdue\s+(\d+)\s+days?/i.test(result)) {
      result = result.replace(/Overdue\s+(\d+)\s+days?/i, 'متأخر $1 يوم');
    }

    // "in Xm" / "Xm ago"
    if (/in\s+(\d+)m\b/i.test(result)) {
      result = result.replace(/in\s+(\d+)m\b/i, 'خلال $1 دقيقة');
    }
    if (/(\d+)m\s+ago/i.test(result)) {
      result = result.replace(/(\d+)m\s+ago/i, 'منذ $1 دقيقة');
    }

    // "in X hours" / "X hours ago"
    if (/in\s+(\d+)\s+hours?/i.test(result)) {
      result = result.replace(/in\s+(\d+)\s+hours?/i, 'خلال $1 ساعة');
    }
    if (/(\d+)\s+hours?\s+ago/i.test(result)) {
      result = result.replace(/(\d+)\s+hours?\s+ago/i, 'منذ $1 ساعة');
    }

    // "in X days" / "X days ago"
    if (/in\s+(\d+)\s+days?/i.test(result)) {
      result = result.replace(/in\s+(\d+)\s+days?/i, 'خلال $1 يوم');
    }
    if (/(\d+)\s+days?\s+ago/i.test(result)) {
      result = result.replace(/(\d+)\s+days?\s+ago/i, 'منذ $1 أيام');
    }

    // "Version X · Client decides"
    if (/Version\s+(\d+)\s*·\s*(.+)\s+decides/i.test(result)) {
      result = result.replace(/Version\s+(\d+)\s*·\s*(.+)\s+decides/i, (_, v, client) => {
        const trClient = PHRASE_DICTIONARY[client.trim()] || client.trim();
        return `النسخة ${v} · قرار ${trClient}`;
      });
    }

    // "Version X" -> "النسخة X"
    if (/Version\s+(\d+)/i.test(result)) {
      result = result.replace(/Version\s+(\d+)/i, 'النسخة $1');
    }

    // Activity feed lines:
    // "Omar commented on Brand film v3" -> "عمر علّق على فيلم الهوية v3"
    if (/^(.+)\s+commented\s+on\s+(.+)$/i.test(result)) {
      result = result.replace(/^(.+)\s+commented\s+on\s+(.+)$/i, (_, actor, target) => {
        const trActor = PHRASE_DICTIONARY[actor.trim()] || actor.trim();
        let trTarget = target.trim();
        for (const [en, ar] of Object.entries(PHRASE_DICTIONARY)) {
          if (trTarget.includes(en)) trTarget = trTarget.replace(en, ar);
        }
        return `${trActor} علّق على ${trTarget}`;
      });
    }

    // "Nile Foods viewed Brand film v3" -> "نايل فودز استعرض فيلم الهوية v3"
    if (/^(.+)\s+viewed\s+(.+)$/i.test(result)) {
      result = result.replace(/^(.+)\s+viewed\s+(.+)$/i, (_, actor, target) => {
        const trActor = PHRASE_DICTIONARY[actor.trim()] || actor.trim();
        let trTarget = target.trim();
        for (const [en, ar] of Object.entries(PHRASE_DICTIONARY)) {
          if (trTarget.includes(en)) trTarget = trTarget.replace(en, ar);
        }
        return `${trActor} استعرض ${trTarget}`;
      });
    }

    // "You completed Storyboard" -> "أكملت لوحة القصة"
    if (/^You\s+completed\s+(.+)$/i.test(result)) {
      result = result.replace(/^You\s+completed\s+(.+)$/i, (_, target) => {
        let trTarget = target.trim();
        for (const [en, ar] of Object.entries(PHRASE_DICTIONARY)) {
          if (trTarget.includes(en)) trTarget = trTarget.replace(en, ar);
        }
        return `أكملت ${trTarget}`;
      });
    }

    // "Who can decide: ..."
    if (/^Who\s+can\s+decide:\s*/i.test(result)) {
      result = result.replace(/^Who\s+can\s+decide:\s*/i, 'المخولون باتخاذ القرار: ');
    }

    // Date formatting: "Mon 26 Oct" or "26 Oct" or "Fri 6 Nov 2026"
    // Numbers stay digits!
    result = result.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g, (d) => DAYS_MAP[d] || d);
    result = result.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (m) => MONTHS_MAP[m] || m);

    // 3. Substring replacement for compound sentences / cards:
    // e.g. "Brand film · Nile Foods · 68%" -> "فيلم الهوية الإعلاني · نايل فودز · 68%"
    for (const [englishPhrase, arabicPhrase] of Object.entries(PHRASE_DICTIONARY)) {
      if (englishPhrase.length > 2 && result.includes(englishPhrase)) {
        result = result.split(englishPhrase).join(arabicPhrase);
      }
    }

    return text.replace(trimmed, result);
  }

  apply(lang, notify = true) {
    const html = document.documentElement;
    const body = document.body;

    if (lang === 'ar') {
      html.setAttribute('lang', 'ar');
      html.setAttribute('dir', 'rtl');
      if (body) body.setAttribute('dir', 'rtl');
      this.translateTree(document.body);
    } else {
      html.setAttribute('lang', 'en');
      html.setAttribute('dir', 'ltr');
      if (body) body.setAttribute('dir', 'ltr');
      this.restoreTree(document.body);
    }

    if (notify && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dw:language-changed', { detail: { lang } }));
    }
  }

  translateTree(root) {
    if (!root || this.currentLang !== 'ar') return;
    this.isTranslating = true;

    try {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            if (['script', 'style', 'code', 'pre', 'noscript'].includes(tag)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (parent.closest('#dw-lang-switcher') || parent.closest('.dw-lang-toggle')) {
              return NodeFilter.FILTER_REJECT;
            }
            const val = node.nodeValue?.trim();
            if (!val || /^[0-9a-f-]{32,}$/i.test(val) || /^https?:\/\//.test(val)) {
              return NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      const nodes = [];
      let currentNode;
      while ((currentNode = walker.nextNode())) {
        nodes.push(currentNode);
      }

      for (const textNode of nodes) {
        const original = textNode.nodeValue;
        if (!this.origTextMap.has(textNode)) {
          this.origTextMap.set(textNode, original);
        }
        const translated = this.translateText(original);
        if (translated !== original) {
          textNode.nodeValue = translated;
        }
      }

      // Translate attributes: placeholder, title, aria-label, option texts
      const elements = root.querySelectorAll('input[placeholder], textarea[placeholder], button, [title], [aria-label], option');
      elements.forEach(el => {
        if (el.closest('#dw-lang-switcher') || el.closest('.dw-lang-toggle')) return;

        // <option> elements
        if (el.tagName.toLowerCase() === 'option') {
          const optText = el.textContent?.trim();
          if (optText) {
            if (!this.origAttrMap.has(el)) this.origAttrMap.set(el, {});
            const stored = this.origAttrMap.get(el);
            if (!stored.text) stored.text = el.textContent;
            const tr = this.translateText(stored.text);
            if (tr !== stored.text) el.textContent = tr;
          }
        }

        // Placeholder
        if (el.placeholder) {
          if (!this.origAttrMap.has(el)) this.origAttrMap.set(el, {});
          const stored = this.origAttrMap.get(el);
          if (!stored.placeholder) stored.placeholder = el.placeholder;
          const tr = this.translateText(stored.placeholder);
          if (tr !== stored.placeholder) el.placeholder = tr;
        }

        // Title
        if (el.title) {
          if (!this.origAttrMap.has(el)) this.origAttrMap.set(el, {});
          const stored = this.origAttrMap.get(el);
          if (!stored.title) stored.title = el.title;
          const tr = this.translateText(stored.title);
          if (tr !== stored.title) el.title = tr;
        }

        // Aria-label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
          if (!this.origAttrMap.has(el)) this.origAttrMap.set(el, {});
          const stored = this.origAttrMap.get(el);
          if (!stored.ariaLabel) stored.ariaLabel = ariaLabel;
          const tr = this.translateText(stored.ariaLabel);
          if (tr !== stored.ariaLabel) el.setAttribute('aria-label', tr);
        }
      });
    } finally {
      this.isTranslating = false;
    }
  }

  restoreTree(root) {
    if (!root) return;
    this.isTranslating = true;

    try {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        null
      );

      let currentNode;
      while ((currentNode = walker.nextNode())) {
        if (this.origTextMap.has(currentNode)) {
          currentNode.nodeValue = this.origTextMap.get(currentNode);
        }
      }

      const elements = root.querySelectorAll('input[placeholder], textarea[placeholder], button, [title], [aria-label], option');
      elements.forEach(el => {
        if (this.origAttrMap.has(el)) {
          const stored = this.origAttrMap.get(el);
          if (stored.text && el.tagName.toLowerCase() === 'option') el.textContent = stored.text;
          if (stored.placeholder) el.placeholder = stored.placeholder;
          if (stored.title) el.title = stored.title;
          if (stored.ariaLabel) el.setAttribute('aria-label', stored.ariaLabel);
        }
      });
    } finally {
      this.isTranslating = false;
    }
  }

  setupObserver() {
    if (typeof window === 'undefined' || !window.MutationObserver) return;
    if (this.observer) this.observer.disconnect();

    this.observer = new MutationObserver((mutations) => {
      if (this.isTranslating || this.currentLang !== 'ar') return;

      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const target = mutation.target;
          if (target && target.nodeType === Node.TEXT_NODE) {
            const parent = target.parentElement;
            if (!parent || parent.closest('#dw-lang-switcher') || parent.closest('.dw-lang-toggle')) continue;
            const original = target.nodeValue;
            if (!this.origTextMap.has(target)) {
              this.origTextMap.set(target, original);
            }
            const tr = this.translateText(original);
            if (tr !== original) {
              target.nodeValue = tr;
            }
          }
        } else if (mutation.type === 'childList') {
          for (const addedNode of mutation.addedNodes) {
            if (addedNode.nodeType === Node.ELEMENT_NODE) {
              if (addedNode.id === 'dw-lang-switcher' || addedNode.classList?.contains('dw-lang-toggle')) continue;
              this.translateTree(addedNode);
            } else if (addedNode.nodeType === Node.TEXT_NODE) {
              const parent = addedNode.parentElement;
              if (!parent || parent.closest('#dw-lang-switcher') || parent.closest('.dw-lang-toggle')) continue;
              const original = addedNode.nodeValue;
              if (!this.origTextMap.has(addedNode)) {
                this.origTextMap.set(addedNode, original);
              }
              const tr = this.translateText(original);
              if (tr !== original) {
                addedNode.nodeValue = tr;
              }
            }
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  mountSwitcher() {
    if (typeof document === 'undefined') return;

    let switcher = document.getElementById('dw-lang-switcher');
    if (!switcher) {
      switcher = document.createElement('div');
      switcher.id = 'dw-lang-switcher';
      switcher.className = 'dw-lang-toggle-wrap';
      switcher.innerHTML = `
        <button type="button" class="dw-lang-toggle" id="dw-lang-toggle-btn" aria-label="Swap language between English and Arabic">
          <span class="dw-lang-icon" aria-hidden="true">🌐</span>
          <span class="dw-lang-text">${this.currentLang === 'ar' ? 'English' : 'العربية'}</span>
        </button>
      `;

      switcher.querySelector('button').onclick = () => {
        this.toggle();
      };

      document.body.appendChild(switcher);
    }

    this.mountToolbarButton();
  }

  mountToolbarButton() {
    const target = document.querySelector('.util') || document.querySelector('.ph > .pr') || document.querySelector('.split .top');
    if (target && !target.querySelector('#toolbar-lang-btn')) {
      const btn = document.createElement('button');
      btn.id = 'toolbar-lang-btn';
      btn.type = 'button';
      btn.className = 'ib dw-toolbar-lang-btn';
      btn.setAttribute('aria-label', 'Swap language between English and Arabic');
      btn.innerHTML = `<span aria-hidden="true">🌐</span> ${this.currentLang === 'ar' ? 'English' : 'العربية'}`;
      btn.onclick = () => this.toggle();

      const logoutBtn = target.querySelector('#logout-btn');
      if (logoutBtn) {
        target.insertBefore(btn, logoutBtn);
      } else {
        target.prepend(btn);
      }
    }
  }

  updateSwitcherUI() {
    const isAr = this.currentLang === 'ar';
    const nextLabel = isAr ? 'English' : 'العربية';

    const floatBtn = document.querySelector('#dw-lang-toggle-btn .dw-lang-text');
    if (floatBtn) {
      floatBtn.textContent = nextLabel;
    }

    const toolBtn = document.querySelector('#toolbar-lang-btn');
    if (toolBtn) {
      toolBtn.innerHTML = `<span aria-hidden="true">🌐</span> ${nextLabel}`;
    }
  }
}

export const i18n = new I18nManager();

if (typeof window !== 'undefined') {
  window.__DW_I18N__ = i18n;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => i18n.init());
  } else {
    i18n.init();
  }
}
