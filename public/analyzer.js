/*
 * ResuMail resume analyzer - 100% rule based, runs in the browser, no AI, no data leaves the device.
 * Also loadable in Node (module.exports) for testing.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Skills dictionary: name, category, aliases. `cs` = case-sensitive alias.
   * ------------------------------------------------------------------ */
  const RAW_SKILLS = [
    // Languages
    ['JavaScript', 'Languages', ['javascript', 'js', 'es6', 'ecmascript']],
    ['TypeScript', 'Languages', ['typescript']],
    ['Python', 'Languages', ['python', 'python3']],
    ['Java', 'Languages', ['java', 'core java', 'java 8', 'java8']],
    ['C', 'Languages', ['c programming', 'c language', 'c/c++'], ['C']],
    ['C++', 'Languages', ['c++', 'cpp']],
    ['C#', 'Languages', ['c#', 'csharp', 'c sharp']],
    ['Go', 'Languages', ['golang']],
    ['Rust', 'Languages', [], ['Rust']],
    ['Kotlin', 'Languages', ['kotlin']],
    ['Swift', 'Languages', [], ['Swift']],
    ['PHP', 'Languages', ['php']],
    ['Ruby', 'Languages', [], ['Ruby']],
    ['Scala', 'Languages', [], ['Scala']],
    ['R', 'Languages', ['r programming', 'rstudio'], ['R']],
    ['Dart', 'Languages', [], ['Dart']],
    ['MATLAB', 'Languages', ['matlab', 'simulink']],
    ['Bash', 'Languages', ['bash', 'shell scripting', 'shell script', 'powershell']],
    ['SQL', 'Data', ['sql', 'pl/sql', 't-sql', 'plsql']],
    // Frontend
    ['HTML', 'Frontend', ['html', 'html5']],
    ['CSS', 'Frontend', ['css', 'css3']],
    ['React', 'Frontend', ['react.js', 'reactjs', 'react js', 'react hooks'], ['React']],
    ['Angular', 'Frontend', ['angular', 'angularjs', 'angular.js']],
    ['Vue.js', 'Frontend', ['vue', 'vue.js', 'vuejs']],
    ['Next.js', 'Frontend', ['next.js', 'nextjs']],
    ['Redux', 'Frontend', ['redux', 'redux toolkit']],
    ['Tailwind CSS', 'Frontend', ['tailwind', 'tailwindcss', 'tailwind css']],
    ['Bootstrap', 'Frontend', ['bootstrap']],
    ['jQuery', 'Frontend', ['jquery']],
    ['SASS', 'Frontend', ['sass', 'scss']],
    ['Webpack', 'Frontend', ['webpack', 'vite']],
    ['Svelte', 'Frontend', ['svelte']],
    // Backend
    ['Node.js', 'Backend', ['node.js', 'nodejs', 'node js']],
    ['Express.js', 'Backend', ['express.js', 'expressjs', 'express js'], ['Express']],
    ['Django', 'Backend', ['django']],
    ['Flask', 'Backend', ['flask']],
    ['FastAPI', 'Backend', ['fastapi']],
    ['Spring Boot', 'Backend', ['spring boot', 'springboot']],
    ['Spring', 'Backend', ['spring framework', 'spring mvc', 'spring security']],
    ['Hibernate', 'Backend', ['hibernate', 'jpa']],
    ['.NET', 'Backend', ['.net', 'dotnet', 'asp.net', '.net core', 'asp.net core']],
    ['Entity Framework', 'Backend', ['entity framework']],
    ['Laravel', 'Backend', ['laravel']],
    ['Ruby on Rails', 'Backend', ['ruby on rails', 'rails']],
    ['REST APIs', 'Backend', ['rest api', 'rest apis', 'restful', 'restful apis', 'restful services', 'rest services']],
    ['GraphQL', 'Backend', ['graphql']],
    ['Microservices', 'Backend', ['microservices', 'microservice', 'micro services']],
    ['Maven', 'Backend', ['maven', 'gradle']],
    // Mobile
    ['Android', 'Mobile', ['android', 'android studio']],
    ['iOS', 'Mobile', ['ios']],
    ['Flutter', 'Mobile', ['flutter']],
    ['React Native', 'Mobile', ['react native', 'react-native']],
    ['Jetpack Compose', 'Mobile', ['jetpack compose']],
    ['SwiftUI', 'Mobile', ['swiftui']],
    ['Xamarin', 'Mobile', ['xamarin']],
    // Data / AI
    ['Pandas', 'Data', ['pandas']],
    ['NumPy', 'Data', ['numpy']],
    ['Matplotlib', 'Data', ['matplotlib']],
    ['Seaborn', 'Data', ['seaborn']],
    ['Scikit-learn', 'Data', ['scikit-learn', 'sklearn', 'scikit learn']],
    ['TensorFlow', 'Data', ['tensorflow']],
    ['PyTorch', 'Data', ['pytorch']],
    ['Keras', 'Data', ['keras']],
    ['Machine Learning', 'Data', ['machine learning', 'ai/ml'], ['ML']],
    ['Deep Learning', 'Data', ['deep learning', 'neural networks', 'cnn', 'rnn', 'lstm']],
    ['NLP', 'Data', ['nlp', 'natural language processing']],
    ['Computer Vision', 'Data', ['computer vision', 'image processing']],
    ['OpenCV', 'Data', ['opencv']],
    ['Generative AI', 'Data', ['generative ai', 'genai', 'gen ai', 'llm', 'llms', 'large language models', 'rag']],
    ['LangChain', 'Data', ['langchain']],
    ['Artificial Intelligence', 'Data', ['artificial intelligence'], ['AI']],
    ['MLOps', 'Data', ['mlops', 'mlflow']],
    ['Statistics', 'Data', ['statistics', 'statistical analysis', 'hypothesis testing']],
    ['Data Analysis', 'Data', ['data analysis', 'data analytics', 'data analyst', 'exploratory data analysis', 'eda']],
    ['Data Visualization', 'Data', ['data visualization', 'data visualisation', 'dashboards', 'dashboarding']],
    ['Power BI', 'Data', ['power bi', 'powerbi', 'dax']],
    ['Tableau', 'Data', ['tableau']],
    ['Excel', 'Data', ['ms excel', 'advanced excel', 'microsoft excel', 'excel vba', 'vlookup', 'pivot tables'], ['Excel']],
    ['Looker', 'Data', ['looker', 'looker studio', 'google data studio']],
    ['Spark', 'Data', ['apache spark', 'pyspark', 'spark sql'], ['Spark']],
    ['Hadoop', 'Data', ['hadoop', 'hive', 'hdfs']],
    ['Kafka', 'Data', ['kafka']],
    ['Airflow', 'Data', ['airflow']],
    ['ETL', 'Data', ['etl', 'elt', 'data pipelines', 'data pipeline']],
    ['Data Warehousing', 'Data', ['data warehouse', 'data warehousing', 'redshift']],
    ['Snowflake', 'Data', ['snowflake']],
    ['Databricks', 'Data', ['databricks']],
    ['BigQuery', 'Data', ['bigquery', 'big query']],
    // Databases
    ['MySQL', 'Databases', ['mysql']],
    ['PostgreSQL', 'Databases', ['postgresql', 'postgres']],
    ['MongoDB', 'Databases', ['mongodb', 'mongo db', 'mongoose']],
    ['Oracle', 'Databases', ['oracle db', 'oracle database'], ['Oracle']],
    ['SQL Server', 'Databases', ['sql server', 'mssql', 'ms sql']],
    ['Redis', 'Databases', ['redis']],
    ['Firebase', 'Databases', ['firebase', 'firestore']],
    ['SQLite', 'Databases', ['sqlite']],
    ['Cassandra', 'Databases', ['cassandra']],
    ['DynamoDB', 'Databases', ['dynamodb']],
    ['Elasticsearch', 'Databases', ['elasticsearch', 'elastic search', 'elk']],
    // Cloud / DevOps
    ['AWS', 'Cloud & DevOps', ['aws', 'amazon web services', 'ec2', 's3', 'lambda']],
    ['Azure', 'Cloud & DevOps', ['azure', 'microsoft azure']],
    ['GCP', 'Cloud & DevOps', ['gcp', 'google cloud', 'google cloud platform']],
    ['Docker', 'Cloud & DevOps', ['docker', 'containerization']],
    ['Kubernetes', 'Cloud & DevOps', ['kubernetes', 'k8s', 'eks', 'aks', 'helm']],
    ['Jenkins', 'Cloud & DevOps', ['jenkins']],
    ['Terraform', 'Cloud & DevOps', ['terraform', 'infrastructure as code']],
    ['Ansible', 'Cloud & DevOps', ['ansible']],
    ['CI/CD', 'Cloud & DevOps', ['ci/cd', 'ci cd', 'continuous integration', 'github actions', 'gitlab ci']],
    ['Git', 'Cloud & DevOps', ['git', 'version control']],
    ['GitHub', 'Cloud & DevOps', ['github']],
    ['GitLab', 'Cloud & DevOps', ['gitlab', 'bitbucket']],
    ['Linux', 'Cloud & DevOps', ['linux', 'ubuntu', 'unix', 'centos']],
    ['Nginx', 'Cloud & DevOps', ['nginx', 'apache tomcat']],
    ['Prometheus', 'Cloud & DevOps', ['prometheus']],
    ['Grafana', 'Cloud & DevOps', ['grafana']],
    // Testing
    ['Selenium', 'Testing', ['selenium', 'selenium webdriver']],
    ['Cypress', 'Testing', ['cypress']],
    ['Playwright', 'Testing', ['playwright']],
    ['Jest', 'Testing', ['jest']],
    ['JUnit', 'Testing', ['junit', 'mockito']],
    ['TestNG', 'Testing', ['testng']],
    ['PyTest', 'Testing', ['pytest']],
    ['Postman', 'Testing', ['postman']],
    ['Appium', 'Testing', ['appium']],
    ['JMeter', 'Testing', ['jmeter', 'load testing', 'performance testing']],
    ['Cucumber', 'Testing', ['cucumber', 'bdd']],
    ['Manual Testing', 'Testing', ['manual testing', 'functional testing', 'regression testing', 'test cases', 'uat']],
    ['Automation Testing', 'Testing', ['automation testing', 'test automation', 'automated testing']],
    // Design
    ['Figma', 'Design', ['figma']],
    ['Adobe XD', 'Design', ['adobe xd']],
    ['Sketch', 'Design', [], ['Sketch']],
    ['Photoshop', 'Design', ['photoshop', 'adobe photoshop']],
    ['Illustrator', 'Design', ['illustrator', 'adobe illustrator']],
    ['InDesign', 'Design', ['indesign']],
    ['CorelDRAW', 'Design', ['coreldraw', 'corel draw']],
    ['After Effects', 'Design', ['after effects']],
    ['Premiere Pro', 'Design', ['premiere pro', 'video editing']],
    ['Canva', 'Design', ['canva']],
    ['UI Design', 'Design', ['ui design', 'ui/ux', 'user interface design'], ['UI']],
    ['UX Design', 'Design', ['ux design', 'ui/ux', 'user experience'], ['UX']],
    ['Wireframing', 'Design', ['wireframing', 'wireframes', 'wireframe']],
    ['Prototyping', 'Design', ['prototyping', 'prototypes']],
    ['User Research', 'Design', ['user research', 'usability testing', 'user interviews']],
    // Security & networking
    ['Network Security', 'Security', ['network security', 'information security', 'cyber security', 'cybersecurity']],
    ['Penetration Testing', 'Security', ['penetration testing', 'pen testing', 'pentesting', 'vapt']],
    ['Ethical Hacking', 'Security', ['ethical hacking', 'ceh']],
    ['Vulnerability Assessment', 'Security', ['vulnerability assessment', 'vulnerability management', 'nessus']],
    ['SIEM', 'Security', ['siem', 'qradar']],
    ['Splunk', 'Security', ['splunk']],
    ['Wireshark', 'Security', ['wireshark']],
    ['Burp Suite', 'Security', ['burp suite', 'burpsuite']],
    ['Kali Linux', 'Security', ['kali linux', 'metasploit']],
    ['Nmap', 'Security', ['nmap']],
    ['OWASP', 'Security', ['owasp']],
    ['Firewalls', 'Security', ['firewall', 'firewalls', 'palo alto', 'fortinet']],
    ['ISO 27001', 'Security', ['iso 27001', 'iso27001']],
    ['CCNA', 'Networking', ['ccna', 'ccnp']],
    ['TCP/IP', 'Networking', ['tcp/ip', 'tcp ip', 'osi model']],
    ['Routing & Switching', 'Networking', ['routing and switching', 'routing & switching', 'routing protocols', 'ospf', 'bgp']],
    ['Cisco', 'Networking', ['cisco']],
    ['DNS', 'Networking', ['dhcp'], ['DNS']],
    ['VPN', 'Networking', ['vpn']],
    ['LAN/WAN', 'Networking', ['lan/wan'], ['LAN', 'WAN']],
    // Engineering
    ['Embedded C', 'Engineering', ['embedded c', 'embedded systems']],
    ['Microcontrollers', 'Engineering', ['microcontroller', 'microcontrollers', '8051', 'arm cortex', 'stm32', 'avr']],
    ['RTOS', 'Engineering', ['rtos', 'freertos']],
    ['Arduino', 'Engineering', ['arduino']],
    ['Raspberry Pi', 'Engineering', ['raspberry pi']],
    ['IoT', 'Engineering', ['iot', 'internet of things']],
    ['VLSI', 'Engineering', ['vlsi']],
    ['Verilog', 'Engineering', ['verilog', 'vhdl', 'systemverilog']],
    ['PCB Design', 'Engineering', ['pcb design', 'altium', 'kicad']],
    ['AutoCAD', 'Engineering', ['autocad', 'auto cad']],
    ['SolidWorks', 'Engineering', ['solidworks', 'solid works']],
    ['CATIA', 'Engineering', ['catia']],
    ['ANSYS', 'Engineering', ['ansys']],
    ['Creo', 'Engineering', ['creo', 'pro/e', 'pro-e']],
    ['Revit', 'Engineering', ['revit']],
    ['STAAD Pro', 'Engineering', ['staad pro', 'staad.pro', 'staad']],
    ['Primavera', 'Engineering', ['primavera']],
    // CS fundamentals
    ['Data Structures & Algorithms', 'Fundamentals', ['data structures', 'algorithms', 'dsa']],
    ['OOP', 'Fundamentals', ['oop', 'oops', 'object oriented programming', 'object-oriented programming', 'object oriented']],
    ['System Design', 'Fundamentals', ['system design', 'low level design', 'high level design', 'design patterns']],
    // Business / PM
    ['Agile', 'Business', ['agile methodology', 'agile methodologies'], ['Agile']],
    ['Scrum', 'Business', ['scrum', 'scrum master', 'sprint planning']],
    ['Jira', 'Business', ['jira']],
    ['Confluence', 'Business', ['confluence']],
    ['Project Management', 'Business', ['project management', 'pmp', 'project planning']],
    ['Product Management', 'Business', ['product management', 'product roadmap', 'product strategy']],
    ['Stakeholder Management', 'Business', ['stakeholder management', 'stakeholder communication', 'client management']],
    ['Requirements Gathering', 'Business', ['requirement gathering', 'requirements gathering', 'requirements analysis', 'brd', 'user stories']],
    ['Business Analysis', 'Business', ['business analysis', 'gap analysis', 'process mapping']],
    ['Risk Management', 'Business', ['risk management', 'risk assessment']],
    ['MS Project', 'Business', ['ms project', 'microsoft project']],
    // Marketing
    ['SEO', 'Marketing', ['seo', 'search engine optimization', 'search engine optimisation']],
    ['SEM', 'Marketing', ['search engine marketing'], ['SEM', 'PPC']],
    ['Google Ads', 'Marketing', ['google ads', 'google adwords', 'adwords']],
    ['Google Analytics', 'Marketing', ['google analytics', 'ga4']],
    ['Social Media Marketing', 'Marketing', ['social media marketing', 'smm', 'social media management', 'instagram marketing']],
    ['Meta Ads', 'Marketing', ['facebook ads', 'meta ads', 'instagram ads']],
    ['Content Marketing', 'Marketing', ['content marketing', 'content strategy']],
    ['Email Marketing', 'Marketing', ['email marketing', 'mailchimp', 'email campaigns']],
    ['Copywriting', 'Marketing', ['copywriting', 'copy writing']],
    ['Content Writing', 'Marketing', ['content writing', 'blog writing', 'technical writing', 'content creation']],
    ['HubSpot', 'Marketing', ['hubspot']],
    ['WordPress', 'Marketing', ['wordpress']],
    // Sales / CRM
    ['Salesforce', 'Sales', ['salesforce', 'sfdc']],
    ['Apex', 'Sales', ['apex triggers', 'apex classes'], ['Apex']],
    ['Lightning (LWC)', 'Sales', ['lightning web components', 'lwc', 'salesforce lightning']],
    ['CRM', 'Sales', ['crm', 'zoho crm']],
    ['Lead Generation', 'Sales', ['lead generation', 'prospecting']],
    ['B2B Sales', 'Sales', ['b2b sales', 'b2b', 'inside sales', 'field sales', 'business development']],
    ['Negotiation', 'Sales', ['negotiation', 'negotiating']],
    ['Cold Calling', 'Sales', ['cold calling', 'telecalling', 'tele calling']],
    ['Customer Service', 'Sales', ['customer service', 'customer support', 'customer relationship', 'client servicing']],
    // Finance
    ['Accounting', 'Finance', ['accounting', 'accounts payable', 'accounts receivable', 'general ledger']],
    ['Tally', 'Finance', ['tally erp', 'tally prime'], ['Tally', 'TALLY']],
    ['GST', 'Finance', ['gst filing', 'gst returns'], ['GST']],
    ['Taxation', 'Finance', ['taxation', 'income tax', 'tds']],
    ['Financial Analysis', 'Finance', ['financial analysis', 'financial reporting', 'financial statements']],
    ['Financial Modeling', 'Finance', ['financial modeling', 'financial modelling', 'valuation']],
    ['Bookkeeping', 'Finance', ['bookkeeping', 'book keeping']],
    ['Auditing', 'Finance', ['auditing', 'internal audit', 'statutory audit']],
    ['QuickBooks', 'Finance', ['quickbooks']],
    ['SAP', 'Finance', ['sap erp', 'sap s/4hana'], ['SAP']],
    ['SAP FICO', 'Finance', ['sap fico', 'sap fi', 'sap co']],
    ['Payroll', 'HR', ['payroll']],
    // HR
    ['Recruitment', 'HR', ['recruitment', 'recruiting', 'talent acquisition', 'sourcing', 'screening']],
    ['Onboarding', 'HR', ['onboarding', 'induction']],
    ['HRMS', 'HR', ['hrms', 'hris', 'workday', 'successfactors']],
    ['Employee Engagement', 'HR', ['employee engagement', 'employee relations']],
    // Soft skills
    ['Communication', 'Soft', ['communication skills', 'communication', 'verbal communication', 'written communication']],
    ['Leadership', 'Soft', ['leadership', 'team lead', 'team leadership']],
    ['Teamwork', 'Soft', ['teamwork', 'team player', 'team work', 'collaboration']],
    ['Problem Solving', 'Soft', ['problem solving', 'problem-solving', 'analytical skills']],
    ['Time Management', 'Soft', ['time management']],
    ['Critical Thinking', 'Soft', ['critical thinking']],
    ['Adaptability', 'Soft', ['adaptability', 'quick learner', 'fast learner']],
    ['Presentation Skills', 'Soft', ['presentation skills', 'public speaking']],
  ];

  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function aliasPattern(alias) {
    return escRe(alias).replace(/\s+/g, '[\\s-]*');
  }
  const SKILLS = RAW_SKILLS.map(([name, cat, aliases, csAliases]) => {
    const parts = [];
    if (aliases && aliases.length) {
      parts.push(new RegExp(`(?<![A-Za-z0-9+#.])(?:${aliases.map(aliasPattern).join('|')})(?![A-Za-z0-9+#])`, 'gi'));
    }
    if (csAliases && csAliases.length) {
      // short, case-sensitive tokens get stricter boundaries ("C", "R", "UI"...)
      parts.push(new RegExp(`(?<![A-Za-z0-9+#.&/\\-'’])(?:${csAliases.map(escRe).join('|')})(?![A-Za-z0-9+#&\\-'’]|\\.[A-Za-z])`, 'g'));
    }
    return { name, cat, res: parts };
  });
  const SKILL_BY_NAME = new Map(SKILLS.map((s) => [s.name.toLowerCase(), s]));

  /* ------------------------------------------------------------------ *
   * Role profiles. core skill = 2 pts, plus skill = 1 pt, title phrase = 3 pts.
   * ------------------------------------------------------------------ */
  const ROLES = [
    { title: 'Frontend Developer', titles: ['frontend developer', 'front-end developer', 'front end developer', 'ui developer', 'react developer', 'angular developer', 'frontend engineer'],
      core: ['JavaScript', 'React', 'HTML', 'CSS', 'TypeScript', 'Angular', 'Vue.js', 'Next.js'],
      plus: ['Redux', 'Tailwind CSS', 'Bootstrap', 'SASS', 'Webpack', 'jQuery', 'Figma', 'Git', 'REST APIs', 'Jest', 'Svelte'] },
    { title: 'Backend Developer', titles: ['backend developer', 'back-end developer', 'back end developer', 'backend engineer', 'api developer'],
      core: ['Node.js', 'Express.js', 'Java', 'Spring Boot', 'Python', 'Django', 'FastAPI', 'Go', 'REST APIs', 'SQL', 'Microservices'],
      plus: ['MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'Docker', 'GraphQL', 'Kafka', 'AWS', 'Git', 'Flask', 'PHP', 'Laravel', 'C#', '.NET', 'System Design'] },
    { title: 'Full Stack Developer', titles: ['full stack', 'full-stack', 'fullstack', 'mern stack', 'mern', 'mean stack'],
      core: ['JavaScript', 'React', 'Node.js', 'Express.js', 'MongoDB', 'HTML', 'CSS', 'REST APIs', 'TypeScript', 'SQL'],
      plus: ['Next.js', 'Angular', 'PostgreSQL', 'MySQL', 'Git', 'Docker', 'AWS', 'Redux', 'Tailwind CSS', 'Django', 'Spring Boot', 'GraphQL'] },
    { title: 'Software Engineer', titles: ['software engineer', 'software developer', 'sde', 'programmer analyst', 'associate software engineer', 'application developer'],
      core: ['Java', 'Python', 'C++', 'JavaScript', 'C', 'C#', 'Go', 'Data Structures & Algorithms', 'OOP', 'SQL'],
      plus: ['Git', 'REST APIs', 'Linux', 'System Design', 'Docker', 'AWS', 'Agile', 'Microservices', 'Spring Boot', 'Node.js'] },
    { title: 'Java Developer', titles: ['java developer', 'java engineer', 'j2ee developer'],
      core: ['Java', 'Spring Boot', 'Spring', 'Hibernate', 'Microservices', 'REST APIs', 'SQL'],
      plus: ['MySQL', 'Oracle', 'JUnit', 'Maven', 'Kafka', 'Docker', 'AWS', 'Git', 'OOP'] },
    { title: 'Python Developer', titles: ['python developer', 'python engineer'],
      core: ['Python', 'Django', 'Flask', 'FastAPI', 'REST APIs', 'SQL'],
      plus: ['Pandas', 'NumPy', 'PostgreSQL', 'MySQL', 'Docker', 'AWS', 'Git', 'Linux', 'PyTest', 'Redis'] },
    { title: '.NET Developer', titles: ['.net developer', 'dotnet developer', 'c# developer'],
      core: ['C#', '.NET', 'SQL Server', 'Entity Framework', 'SQL'],
      plus: ['Azure', 'REST APIs', 'JavaScript', 'Angular', 'Microservices', 'Git'] },
    { title: 'Mobile App Developer', titles: ['android developer', 'ios developer', 'mobile developer', 'mobile app developer', 'flutter developer', 'react native developer', 'app developer'],
      core: ['Android', 'Kotlin', 'Swift', 'Flutter', 'React Native', 'iOS', 'Dart'],
      plus: ['Java', 'Firebase', 'Jetpack Compose', 'SwiftUI', 'REST APIs', 'Git', 'Xamarin'] },
    { title: 'Data Analyst', titles: ['data analyst', 'business intelligence', 'bi analyst', 'bi developer', 'mis executive', 'mis analyst', 'reporting analyst'],
      core: ['SQL', 'Excel', 'Power BI', 'Tableau', 'Python', 'Data Analysis', 'Data Visualization', 'Statistics'],
      plus: ['Pandas', 'NumPy', 'R', 'Looker', 'Matplotlib', 'Seaborn', 'ETL', 'Google Analytics', 'BigQuery'] },
    { title: 'Data Scientist', titles: ['data scientist', 'data science'],
      core: ['Python', 'Machine Learning', 'Statistics', 'Pandas', 'NumPy', 'Scikit-learn', 'Deep Learning', 'SQL', 'R'],
      plus: ['TensorFlow', 'PyTorch', 'NLP', 'Data Visualization', 'Matplotlib', 'Spark', 'Computer Vision', 'Keras', 'Generative AI'] },
    { title: 'Machine Learning Engineer', titles: ['machine learning engineer', 'ml engineer', 'ai engineer', 'ai/ml engineer', 'deep learning engineer', 'nlp engineer'],
      core: ['Machine Learning', 'Deep Learning', 'Python', 'TensorFlow', 'PyTorch', 'NLP', 'Computer Vision', 'Generative AI'],
      plus: ['Scikit-learn', 'Keras', 'Docker', 'AWS', 'OpenCV', 'LangChain', 'Kubernetes', 'MLOps', 'Artificial Intelligence'] },
    { title: 'Data Engineer', titles: ['data engineer', 'big data engineer', 'etl developer'],
      core: ['SQL', 'Python', 'Spark', 'ETL', 'Airflow', 'Kafka', 'Data Warehousing', 'Hadoop', 'Snowflake', 'Databricks'],
      plus: ['AWS', 'Azure', 'GCP', 'BigQuery', 'Scala', 'Docker', 'PostgreSQL'] },
    { title: 'DevOps / Cloud Engineer', titles: ['devops engineer', 'devops', 'cloud engineer', 'site reliability', 'sre', 'cloud architect', 'platform engineer'],
      core: ['AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Jenkins', 'Terraform', 'CI/CD', 'Linux', 'Ansible'],
      plus: ['Git', 'Bash', 'Python', 'Prometheus', 'Grafana', 'Nginx', 'GitHub', 'GitLab'] },
    { title: 'QA / Test Engineer', titles: ['qa engineer', 'qa analyst', 'quality assurance', 'test engineer', 'software tester', 'sdet', 'automation tester', 'manual tester'],
      core: ['Manual Testing', 'Automation Testing', 'Selenium', 'Cypress', 'Playwright', 'JUnit', 'TestNG', 'PyTest', 'Postman', 'Appium', 'JMeter'],
      plus: ['Java', 'Python', 'Jira', 'SQL', 'Cucumber', 'Jest', 'Agile', 'CI/CD'] },
    { title: 'UI/UX Designer', titles: ['ui/ux designer', 'ux designer', 'ui designer', 'product designer', 'interaction designer'],
      core: ['Figma', 'Adobe XD', 'UI Design', 'UX Design', 'Wireframing', 'Prototyping', 'User Research', 'Sketch'],
      plus: ['Photoshop', 'Illustrator', 'HTML', 'CSS', 'Canva'] },
    { title: 'Graphic Designer', titles: ['graphic designer', 'visual designer', 'video editor', 'motion designer'],
      core: ['Photoshop', 'Illustrator', 'CorelDRAW', 'InDesign', 'Canva', 'After Effects', 'Premiere Pro'],
      plus: ['Figma', 'UI Design'] },
    { title: 'Cybersecurity Analyst', titles: ['security analyst', 'cyber security analyst', 'cybersecurity analyst', 'soc analyst', 'penetration tester', 'security engineer'],
      core: ['Network Security', 'Penetration Testing', 'Ethical Hacking', 'SIEM', 'Splunk', 'Vulnerability Assessment', 'OWASP', 'Burp Suite', 'Kali Linux', 'Wireshark'],
      plus: ['Linux', 'Nmap', 'Firewalls', 'Python', 'ISO 27001', 'TCP/IP'] },
    { title: 'Network Engineer', titles: ['network engineer', 'network administrator', 'system administrator', 'it support engineer'],
      core: ['CCNA', 'TCP/IP', 'Routing & Switching', 'Cisco', 'Firewalls', 'DNS', 'VPN', 'LAN/WAN'],
      plus: ['Linux', 'Network Security', 'Wireshark', 'Azure', 'AWS'] },
    { title: 'Embedded Systems Engineer', titles: ['embedded engineer', 'embedded systems engineer', 'firmware engineer', 'embedded developer', 'vlsi engineer'],
      core: ['Embedded C', 'C', 'Microcontrollers', 'RTOS', 'Arduino', 'Raspberry Pi', 'IoT', 'VLSI', 'Verilog'],
      plus: ['C++', 'Python', 'PCB Design', 'MATLAB', 'Linux'] },
    { title: 'Mechanical Design Engineer', titles: ['mechanical engineer', 'design engineer', 'production engineer', 'cad engineer'],
      core: ['AutoCAD', 'SolidWorks', 'CATIA', 'ANSYS', 'Creo'],
      plus: ['MATLAB', 'MS Project'] },
    { title: 'Civil Engineer', titles: ['civil engineer', 'site engineer', 'structural engineer'],
      core: ['AutoCAD', 'Revit', 'STAAD Pro', 'Primavera'],
      plus: ['MS Project', 'Excel', 'Project Management'] },
    { title: 'Business Analyst', titles: ['business analyst', 'functional analyst', 'business systems analyst'],
      core: ['Business Analysis', 'Requirements Gathering', 'SQL', 'Excel', 'Power BI', 'Stakeholder Management', 'Agile', 'Jira'],
      plus: ['Tableau', 'Confluence', 'Scrum', 'Data Analysis', 'Communication'] },
    { title: 'Project / Product Manager', titles: ['project manager', 'product manager', 'scrum master', 'program manager', 'delivery manager', 'project coordinator'],
      core: ['Project Management', 'Product Management', 'Agile', 'Scrum', 'Jira', 'Stakeholder Management', 'Risk Management'],
      plus: ['MS Project', 'Confluence', 'Leadership', 'Communication', 'Requirements Gathering'] },
    { title: 'Digital Marketing Specialist', titles: ['digital marketing', 'marketing executive', 'seo executive', 'seo specialist', 'social media manager', 'performance marketer', 'marketing manager'],
      core: ['SEO', 'SEM', 'Google Ads', 'Google Analytics', 'Social Media Marketing', 'Meta Ads', 'Content Marketing', 'Email Marketing'],
      plus: ['WordPress', 'HubSpot', 'Canva', 'Copywriting', 'Content Writing'] },
    { title: 'Content Writer', titles: ['content writer', 'copywriter', 'technical writer', 'content creator'],
      core: ['Content Writing', 'Copywriting', 'SEO', 'Content Marketing'],
      plus: ['WordPress', 'Canva', 'Social Media Marketing', 'Communication'] },
    { title: 'Sales / Business Development', titles: ['sales executive', 'sales manager', 'business development executive', 'business development manager', 'account manager', 'bde', 'inside sales'],
      core: ['B2B Sales', 'Lead Generation', 'CRM', 'Negotiation', 'Cold Calling', 'Salesforce', 'Customer Service'],
      plus: ['Communication', 'Excel', 'HubSpot', 'Presentation Skills'] },
    { title: 'Salesforce Developer', titles: ['salesforce developer', 'salesforce administrator', 'salesforce consultant'],
      core: ['Salesforce', 'Apex', 'Lightning (LWC)'],
      plus: ['JavaScript', 'SQL', 'REST APIs', 'CRM'] },
    { title: 'Accountant / Finance Executive', titles: ['accountant', 'accounts executive', 'finance executive', 'financial analyst', 'audit associate', 'tax consultant'],
      core: ['Accounting', 'Tally', 'GST', 'Taxation', 'Financial Analysis', 'Bookkeeping', 'Auditing', 'QuickBooks', 'SAP FICO', 'Financial Modeling'],
      plus: ['Excel', 'Payroll', 'SAP'] },
    { title: 'HR Executive', titles: ['hr executive', 'hr generalist', 'hr manager', 'human resources', 'recruiter', 'talent acquisition'],
      core: ['Recruitment', 'Onboarding', 'HRMS', 'Employee Engagement', 'Payroll'],
      plus: ['Communication', 'Excel', 'Leadership'] },
  ];

  /* ------------------------------------------------------------------ *
   * Section detection
   * ------------------------------------------------------------------ */
  const HEADINGS = {
    summary: ['summary', 'profile', 'professional summary', 'career objective', 'objective', 'about me', 'profile summary', 'career summary', 'professional profile', 'about'],
    experience: ['experience', 'work experience', 'professional experience', 'employment history', 'work history', 'employment', 'career history', 'experience summary', 'relevant experience', 'professional background', 'work experience details'],
    internship: ['internship', 'internships', 'internship experience', 'industrial training', 'internships training', 'training internships'],
    education: ['education', 'academic', 'academics', 'educational qualification', 'educational qualifications', 'academic qualifications', 'academic qualification', 'qualifications', 'qualification', 'academic background', 'education details', 'educational background', 'education and training', 'academic details', 'academic profile'],
    skills: ['skills', 'technical skills', 'key skills', 'core skills', 'skill set', 'skillset', 'core competencies', 'competencies', 'technologies', 'tech stack', 'tools', 'tools technologies', 'technical proficiency', 'areas of expertise', 'expertise', 'it skills', 'software skills', 'technical expertise', 'skills summary', 'professional skills', 'key skills tools', 'soft skills', 'technical skill', 'skills tools'],
    projects: ['projects', 'academic projects', 'personal projects', 'key projects', 'project', 'project details', 'project experience', 'major projects', 'notable projects', 'mini projects'],
    certifications: ['certifications', 'certification', 'certificates', 'courses', 'licenses certifications', 'licenses and certifications', 'training certifications', 'certifications courses', 'online courses', 'certifications and training'],
    achievements: ['achievements', 'awards', 'honors', 'honours', 'accomplishments', 'awards achievements', 'achievements awards', 'awards and achievements'],
    other: ['hobbies', 'interests', 'languages', 'languages known', 'declaration', 'personal details', 'personal information', 'personal profile', 'extra curricular activities', 'extracurricular activities', 'extra curricular', 'references', 'strengths', 'publications', 'volunteer', 'volunteering', 'activities', 'positions of responsibility', 'contact', 'contact details', 'leadership', 'co curricular activities'],
  };
  const HEADING_LOOKUP = new Map();
  Object.entries(HEADINGS).forEach(([k, list]) => list.forEach((h) => HEADING_LOOKUP.set(h, k)));
  const normHeading = (s) => s.toLowerCase().replace(/&/g, ' ').replace(/\band\b/g, ' and ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

  function headingOf(line) {
    const t = line.trim();
    if (!t || t.length > 48) return null;
    const n = normHeading(t);
    if (HEADING_LOOKUP.has(n)) return HEADING_LOOKUP.get(n);
    const noAnd = n.replace(/\band\b/g, '').replace(/\s+/g, ' ').trim();
    if (HEADING_LOOKUP.has(noAnd)) return HEADING_LOOKUP.get(noAnd);
    return null;
  }

  function splitSections(lines) {
    const sections = { header: [] };
    let current = 'header';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let h = headingOf(line);
      let rest = '';
      if (!h) {
        // "Skills: Java, Python" style inline headings
        const m = line.match(/^([A-Za-z &/]{3,40})\s*[:\-–|]\s*(.+)$/);
        if (m) { const hh = headingOf(m[1]); if (hh) { h = hh; rest = m[2]; } }
      }
      if (h) {
        current = h;
        sections[current] = sections[current] || [];
        if (rest) sections[current].push(rest);
        continue;
      }
      (sections[current] = sections[current] || []).push(line);
    }
    return sections;
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'.-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function article(phrase) {
    const w = String(phrase || '').trim();
    if (!w) return 'a';
    const first = w.split(/[\s/]/)[0];
    if (/^[A-Z]{1,5}(?![a-z])/.test(first)) return /^[AEFHILMNORSX]/.test(first) ? 'an' : 'a'; // acronyms: "an HR", "an MBA", "a UI"
    if (/^(uni|use|usu|eu|one|ui|ux)/i.test(w)) return 'a';
    return /^[aeiou]/i.test(w) ? 'an' : 'a';
  }
  function listJoin(items) {
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }
  // Never overstate experience: computed values round DOWN to the nearest half year.
  function fmtYears(y, stated) {
    if (!y || y <= 0) return '';
    if (y < 1) { const m = Math.max(1, Math.round(y * 12)); return `${m} month${m === 1 ? '' : 's'}`; }
    const r = stated ? y : Math.floor(y * 2) / 2;
    const plus = stated || y - r > 0.08;
    return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}${plus ? '+' : ''} year${r === 1 && !plus ? '' : 's'}`;
  }

  /* ------------------------------------------------------------------ *
   * Contact & name
   * ------------------------------------------------------------------ */
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  function findContacts(text) {
    const email = (text.match(EMAIL_RE) || [''])[0];
    let phone = '';
    const phoneRe = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?)?\d[\d\s.-]{7,14}\d/g;
    let m;
    while ((m = phoneRe.exec(text))) {
      const cand = m[0].trim();
      const digits = cand.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 13) continue;
      if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(cand)) continue;
      if (/(19|20)\d{2}[\s.-]+(19|20)\d{2}/.test(cand) && digits.length === 8) continue;
      phone = cand.replace(/\s{2,}/g, ' ');
      break;
    }
    const li = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_\-%.]+\/?/i);
    const gh = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i);
    let portfolio = '';
    const urls = text.match(/(?:https?:\/\/)[^\s|,;()<>]+/gi) || [];
    for (const u of urls) {
      if (!/linkedin\.com|github\.com|mailto:/i.test(u)) { portfolio = u.replace(/[.)]+$/, ''); break; }
    }
    const norm = (u) => (u ? (/^https?:/i.test(u) ? u : `https://${u}`).replace(/\/$/, '') : '');
    return { email, phone, linkedin: norm(li && li[0]), github: norm(gh && gh[0]), portfolio };
  }

  const NOT_NAME = /\b(resume|curriculum|vitae|cv|profile|summary|objective|engineer|developer|manager|analyst|designer|email|phone|mobile|address|contact|linkedin|github|www|http|skills|experience|education|india|street|road|nagar|city|consultant|specialist|executive|intern|student|graduate)\b/i;
  function findName(lines, email) {
    for (const raw of lines.slice(0, 8)) {
      let line = raw.split(/[|•·,]| {3,}/)[0].trim();
      if (/^([A-Z] ){2,}[A-Z]/.test(line)) line = line.replace(/ {2,}/g, '\u0000').replace(/ /g, '').replace(/\u0000/g, ' '); // "J O H N  D O E"
      line = line.replace(/^name\s*[:\-]\s*/i, '');
      if (!line || line.length > 40 || /\d|@/.test(line) || NOT_NAME.test(line)) continue;
      const words = line.split(/\s+/);
      if (words.length < 1 || words.length > 4) continue;
      if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) continue;
      if (words.length === 1 && words[0].length < 3) continue;
      return line === line.toUpperCase() || line === line.toLowerCase() ? titleCase(line) : line;
    }
    if (email) {
      const local = email.split('@')[0].replace(/\d+/g, ' ');
      const parts = local.split(/[._\- ]+/).filter((p) => p.length > 1);
      if (parts.length >= 2) return titleCase(parts.slice(0, 3).join(' '));
    }
    return '';
  }

  /* ------------------------------------------------------------------ *
   * Experience
   * ------------------------------------------------------------------ */
  const DATE_TOKEN = '(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?[\\s,\']*\\d{2,4}|\\d{1,2}[\\/.\\-]\\d{4}|\\d{4})';
  const RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|till|until|~)\\s*(${DATE_TOKEN}|present|current|currently|now|till date|to date|today|ongoing|date)`, 'gi');

  function parseDateToken(tok, now) {
    const t = tok.toLowerCase().trim();
    if (/present|current|now|date|today|ongoing/.test(t)) return now.getFullYear() * 12 + now.getMonth();
    let m = t.match(/^([a-z]{3})[a-z]*\.?[\s,']*(\d{2,4})$/);
    if (m && m[1] in MONTHS) {
      let y = Number(m[2]); if (y < 100) y += 2000;
      return y * 12 + MONTHS[m[1]];
    }
    m = t.match(/^(\d{1,2})[/.-](\d{4})$/);
    if (m) { const mo = Number(m[1]); if (mo >= 1 && mo <= 12) return Number(m[2]) * 12 + mo - 1; return null; }
    m = t.match(/^(\d{4})$/);
    if (m) return Number(m[1]) * 12;
    return null;
  }

  function monthsFromRanges(text, now) {
    const intervals = [];
    const nowIdx = now.getFullYear() * 12 + now.getMonth();
    RANGE_RE.lastIndex = 0;
    let m;
    while ((m = RANGE_RE.exec(text))) {
      const s = parseDateToken(m[1], now);
      let e = parseDateToken(m[2], now);
      if (s == null || e == null) continue;
      const sy = Math.floor(s / 12);
      if (sy < 1975 || e > nowIdx + 1 || e < s || e - s > 480) continue;
      if (/^\d{4}$/.test(m[2].trim()) && /^\d{4}$/.test(m[1].trim()) && e === s) e = s + 6; // "2023 - 2023"
      intervals.push([s, e === s ? s + 1 : e]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0; let cur = null;
    for (const iv of intervals) {
      if (!cur) { cur = iv.slice(); continue; }
      if (iv[0] <= cur[1]) cur[1] = Math.max(cur[1], iv[1]);
      else { total += cur[1] - cur[0]; cur = iv.slice(); }
    }
    if (cur) total += cur[1] - cur[0];
    return { months: total, count: intervals.length };
  }

  function statedYears(text) {
    const re = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)(?:\s+and\s+\d{1,2}\s+months?)?\s+(?:of\s+)?(?:[a-z/&-]+\s+){0,4}?(?:experience|exp\b)/gi;
    let best = 0; let m;
    while ((m = re.exec(text))) { const v = parseFloat(m[1]); if (v > best && v < 45) best = v; }
    return best;
  }

  /* ------------------------------------------------------------------ *
   * Education
   * ------------------------------------------------------------------ */
  const DEGREES = [
    { re: /\b(ph\.?\s?d|doctor of philosophy)\b/i, label: 'PhD', level: 6 },
    { re: /\bm\.?\s?tech\b/i, label: 'M.Tech', level: 5 },
    { re: /\bM\.\s?E\.?(?![A-Za-z])/, label: 'M.E.', level: 5 },
    { re: /\bm\.?\s?b\.?\s?a\b|\bpgdm\b|post\s?graduate diploma in management/i, label: 'MBA', level: 5 },
    { re: /\bm\.?\s?c\.?\s?a\b/i, label: 'MCA', level: 5 },
    { re: /\bm\.?\s?sc\b/i, label: 'M.Sc', level: 5 },
    { re: /\bm\.?\s?com\b/i, label: 'M.Com', level: 5 },
    { re: /\bM\.?S\.?(?=\s+(?:in|\())/, label: 'M.S.', level: 5 },
    { re: /\bmaster(?:'s|s)?\s+(?:of|in|degree)\b/i, label: "Master's", level: 5 },
    { re: /\bm\.?\s?pharm\b/i, label: 'M.Pharm', level: 5 },
    { re: /\bmbbs\b/i, label: 'MBBS', level: 4 },
    { re: /\bb\.?\s?tech\b/i, label: 'B.Tech', level: 3 },
    { re: /\bB\.\s?E\.?(?![A-Za-z])|\bBE(?=\s*(?:in\b|\(|-|–|,|\/))/, label: 'B.E.', level: 3 },
    { re: /\bb\.?\s?c\.?\s?a\b/i, label: 'BCA', level: 3 },
    { re: /\bb\.?\s?b\.?\s?a\b/i, label: 'BBA', level: 3 },
    { re: /\bb\.?\s?sc\b/i, label: 'B.Sc', level: 3 },
    { re: /\bb\.?\s?com\b(?!\/)/i, label: 'B.Com', level: 3 },
    { re: /\bb\.?\s?pharm\b/i, label: 'B.Pharm', level: 3 },
    { re: /\bB\.?A\.?(?=\s+(?:in\b|\(|hons|honours))/, label: 'B.A.', level: 3 },
    { re: /\bbachelor(?:'s|s)?\s+(?:of|in|degree)\b/i, label: "Bachelor's", level: 3 },
    { re: /\bdiploma\b|\bpolytechnic\b/i, label: 'Diploma', level: 2 },
    { re: /\b(12th|xii|intermediate|hsc|higher secondary|senior secondary)\b/i, label: '12th', level: 1 },
  ];
  const FIELDS = [
    ['Computer Science and Engineering', /computer science (and|&) engineering|\bcse\b/i],
    ['Artificial Intelligence and Data Science', /artificial intelligence (and|&) data science|\bai\s?&\s?ds\b|\baids\b/i],
    ['Artificial Intelligence and Machine Learning', /artificial intelligence (and|&) machine learning|\baiml\b|\bai\s?&\s?ml\b/i],
    ['Computer Science', /computer science|\bcs\b(?=\s*[),])/i],
    ['Information Technology', /information technology/i],
    ['Information Technology', /\(IT\)|\bIT\b(?=\s*[),])/],
    ['Computer Applications', /computer applications?/i],
    ['Data Science', /data science/i],
    ['Electronics and Communication Engineering', /electronics (and|&) communication|\bece\b/i],
    ['Electrical and Electronics Engineering', /electrical (and|&) electronics|\beee\b/i],
    ['Electronics', /electronics/i],
    ['Electrical Engineering', /electrical/i],
    ['Mechanical Engineering', /mechanical/i],
    ['Civil Engineering', /\bcivil\b/i],
    ['Chemical Engineering', /chemical/i],
    ['Aeronautical Engineering', /aeronautical|aerospace/i],
    ['Biotechnology', /biotechnology|biotech/i],
    ['Mathematics', /mathematics|\bmaths\b/i],
    ['Statistics', /\bstatistics\b/i],
    ['Physics', /\bphysics\b/i],
    ['Commerce', /commerce/i],
    ['Finance', /\bfinance\b/i],
    ['Marketing', /\bmarketing\b/i],
    ['Human Resources', /human resource/i],
    ['Business Administration', /business administration/i],
    ['Economics', /economics/i],
    ['Pharmacy', /pharmacy/i],
  ];
  const INSTITUTION_RE = /(university|college|institute|institution|iit\b|nit\b|iiit\b|school of|academy|vidyalaya|polytechnic)/i;

  function findEducation(eduLines, allLines) {
    const pool = eduLines && eduLines.length ? eduLines : allLines;
    let best = null;
    pool.forEach((line, i) => {
      for (const d of DEGREES) {
        if (d.re.test(line) && (!best || d.level > best.level)) {
          best = { label: d.label, level: d.level, index: i, line };
          break;
        }
      }
    });
    if (!best) return null;
    const ctx = [pool[best.index - 1] || '', pool[best.index], pool[best.index + 1] || ''].join(' ');
    let field = '';
    for (const [name, re] of FIELDS) { if (re.test(pool[best.index]) || re.test(pool[best.index + 1] || '')) { field = name; break; } }
    let institution = '';
    for (let j = Math.max(0, best.index - 2); j <= Math.min(pool.length - 1, best.index + 3); j++) {
      if (INSTITUTION_RE.test(pool[j])) {
        const seg = pool[j].split(/[|,–—]| - |\s{2,}/).find((s) => INSTITUTION_RE.test(s)) || pool[j];
        institution = seg.replace(/\(?\b(19|20)\d{2}\b.*$/, '').replace(/\s+/g, ' ').trim().slice(0, 90);
        break;
      }
    }
    const g = ctx.match(/\b(cgpa|gpa|cpi)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)(\s*\/\s*\d{1,2}(?:\.\d)?)?/i);
    const cgpa = g ? `${g[2]}${g[3] ? g[3].replace(/\s/g, '') : ''}` : '';
    return {
      degree: best.label,
      level: best.level,
      field,
      institution,
      cgpa,
      short: field ? `${best.label} in ${field}` : best.label,
    };
  }

  /* ------------------------------------------------------------------ *
   * Skills
   * ------------------------------------------------------------------ */
  function findSkills(text, skillsText) {
    const found = [];
    for (const s of SKILLS) {
      let count = 0;
      for (const re of s.res) { re.lastIndex = 0; const m = text.match(re); if (m) count += m.length; }
      if (!count) continue;
      let inSkills = false;
      if (skillsText) for (const re of s.res) { re.lastIndex = 0; if (re.test(skillsText)) { inSkills = true; break; } }
      found.push({ name: s.name, cat: s.cat, count, score: count + (inSkills ? 3 : 0) });
    }
    found.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return found;
  }

  function extraSkillsFromSection(skillLines, known) {
    const out = [];
    const seen = new Set(known.map((k) => k.toLowerCase()));
    for (const raw of skillLines || []) {
      let line = raw.replace(/^[\s•●▪■◦\-*–·]+/, '');
      const colon = line.indexOf(':');
      if (colon > 0 && colon < 30) line = line.slice(colon + 1);
      for (let tok of line.split(/[,|•●▪;·]|\s{2,}| – | - /)) {
        tok = tok.replace(/[()[\]]/g, '').trim();
        if (tok.length < 2 || tok.length > 28 || /^\d+$/.test(tok) || tok.split(/\s+/).length > 4) continue;
        if (/^(and|etc|others?|basic|intermediate|advanced|good|knowledge|of|in)$/i.test(tok)) continue;
        const key = tok.toLowerCase();
        if (seen.has(key) || SKILL_BY_NAME.has(key)) continue;
        // skip tokens that already matched a known skill alias
        if (SKILLS.some((s) => s.res.some((re) => { re.lastIndex = 0; return re.test(tok); }))) continue;
        seen.add(key);
        out.push(tok);
        if (out.length >= 12) return out;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Roles
   * ------------------------------------------------------------------ */
  function scoreRoles(skillNames, text) {
    const have = new Set(skillNames);
    const lower = text.toLowerCase();
    const results = [];
    for (const r of ROLES) {
      const core = r.core.filter((s) => have.has(s));
      const plus = r.plus.filter((s) => have.has(s));
      const titleHit = r.titles.some((t) => new RegExp(`(?<![a-z])${escRe(t)}(?![a-z])`).test(lower));
      if (!core.length && !titleHit) continue;
      const w = core.length * 2 + plus.length + (titleHit ? 3 : 0);
      const fit = Math.min(97, Math.round(100 * (1 - Math.exp(-w / 8))));
      results.push({ title: r.title, fit, matched: core.concat(plus), titleHit });
    }
    results.sort((a, b) => b.fit - a.fit || b.matched.length - a.matched.length);
    return results.filter((r) => r.fit >= 20).slice(0, 5);
  }

  function seniorityOf(years) {
    if (!years || years < 1) return 'Entry level';
    if (years < 3) return 'Junior';
    if (years < 6) return 'Mid level';
    if (years < 10) return 'Senior';
    return 'Lead / Principal';
  }

  function cleanCert(line) {
    return line.replace(/^[\s•●▪■◦\-*–·\d.)]+/, '').split(/ \| | – | - |\(|,/)[0].replace(/\b(19|20)\d{2}\b.*$/, '').trim();
  }

  /* ------------------------------------------------------------------ *
   * Main entry
   * ------------------------------------------------------------------ */
  function analyze(rawText, opts) {
    const now = (opts && opts.now) || new Date();
    const text = String(rawText || '').replace(/\r/g, '').replace(/[   ]/g, ' ').replace(/[ \t]+/g, ' ');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const sections = splitSections(lines);
    const contacts = findContacts(text);
    const name = findName(sections.header && sections.header.length ? sections.header.concat(lines.slice(0, 3)) : lines, contacts.email);

    const skillsText = (sections.skills || []).join('\n');
    const allSkills = findSkills(text, skillsText);
    const hard = allSkills.filter((s) => s.cat !== 'Soft');
    const soft = allSkills.filter((s) => s.cat === 'Soft');
    const extra = extraSkillsFromSection(sections.skills, allSkills.map((s) => s.name));

    const expText = (sections.experience || []).join('\n');
    const internText = (sections.internship || []).join('\n');
    const stated = statedYears(text);
    const computed = expText ? monthsFromRanges(expText, now) : { months: 0, count: 0 };
    const intern = internText ? monthsFromRanges(internText, now) : { months: 0, count: 0 };
    let years = 0; let expSource = 'none';
    if (stated) { years = stated; expSource = 'stated'; } else if (computed.months) { years = Math.round((computed.months / 12) * 10) / 10; expSource = 'computed'; }
    const isFresher = /\bfresher\b/i.test(text) && !stated;
    if (isFresher && years > 1) { years = 0; expSource = 'none'; }
    const hasInternship = !!internText || /\bintern(ship)?\b/i.test(expText);

    const education = findEducation(sections.education, lines);
    const roles = scoreRoles(allSkills.map((s) => s.name), text);
    const certifications = (sections.certifications || []).map(cleanCert).filter((c) => c.length >= 4 && c.length <= 70).slice(0, 4);
    const summary = (sections.summary || []).join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);
    const job = findCurrentJob(sections.experience || sections.internship);
    const achievement = findAchievement((sections.experience || []).concat(sections.projects || []));
    const location = findLocation(lines, name);

    return {
      name,
      ...contacts,
      skills: hard,
      softSkills: soft,
      extraSkills: extra,
      experienceYears: years,
      experienceSource: expSource,
      experienceLabel: years ? fmtYears(years, expSource === 'stated') : (hasInternship ? 'Internship experience' : 'Fresher'),
      internshipMonths: intern.months,
      hasInternship,
      seniority: seniorityOf(years),
      education,
      roles,
      certifications,
      hasProjects: !!(sections.projects && sections.projects.length),
      summary,
      sectionsFound: Object.keys(sections).filter((k) => k !== 'header'),
      currentTitle: job.title,
      currentCompany: job.company,
      achievement,
      location,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  /* ------------------------------------------------------------------ *
   * Current job, key achievement, location
   * ------------------------------------------------------------------ */
  const TITLE_WORDS = /\b(developer|engineer|analyst|manager|designer|intern|executive|consultant|specialist|lead|architect|associate|tester|administrator|officer|coordinator|scientist|accountant|recruiter|programmer|trainee|director|writer|marketer|sde|sre)\b/i;
  const STRONG_VERB = /^(built|developed|led|designed|implemented|improved|reduced|increased|created|launched|managed|automated|optimi[sz]ed|delivered|migrated|architected|drove|grew|achieved|streamlined|scaled|introduced|established|spearheaded|won|mentored|trained|generated|cut|saved|boosted|enhanced|engineered|redesigned|shipped)\b/i;
  const cleanPart = (s) => s.replace(/^[\s•●▪■◦\-*–·:]+|[\s,;:|–-]+$/g, '').trim();
  const BULLET_START = /^[•●▪■◦*\-–]/;

  function findCurrentJob(expLines) {
    const lines = expLines || [];
    for (let i = 0; i < Math.min(lines.length, 14); i++) {
      const line = lines[i];
      if (BULLET_START.test(line) || !TITLE_WORDS.test(line) || line.length > 140) continue;
      const s = line.replace(new RegExp(RANGE_RE.source, 'gi'), ' ').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/[()]/g, ' ');
      const parts = s.split(/\s*\|\s*|\s+[–—-]\s+|,\s*|\s+at\s+|\s+@\s+|\s{2,}/).map(cleanPart).filter((x) => x.length > 1 && /[A-Za-z]/.test(x));
      const ti = parts.findIndex((p) => TITLE_WORDS.test(p) && p.split(/\s+/).length <= 6);
      if (ti < 0) continue;
      let company = parts.find((p, idx) => idx !== ti && !TITLE_WORDS.test(p) && !/present|current|till|now|month|year/i.test(p) && p.split(/\s+/).length <= 6) || '';
      if (!company && lines[i + 1] && !TITLE_WORDS.test(lines[i + 1]) && !BULLET_START.test(lines[i + 1])) {
        const nxt = cleanPart(lines[i + 1].replace(new RegExp(RANGE_RE.source, 'gi'), ' ').split(/\s*\|\s*|,\s*|\s{2,}/)[0] || '');
        if (nxt && nxt.split(/\s+/).length <= 6 && !STRONG_VERB.test(nxt)) company = nxt;
      }
      return { title: parts[ti].slice(0, 60), company: company.slice(0, 60) };
    }
    return { title: '', company: '' };
  }

  function findAchievement(lines) {
    let best = null; let bestScore = 0;
    for (const raw of lines || []) {
      const line = cleanPart(raw);
      if (line.length < 30 || line.length > 200 || !STRONG_VERB.test(line)) continue;
      let score = 1;
      if (/\d/.test(line)) score += 2;
      if (/%|\d+\s*(x|k|m|lakh|crore|users|clients|teams|hours|days|ms|seconds)\b/i.test(line)) score += 1;
      if (score > bestScore) { best = line; bestScore = score; }
    }
    if (!best) return '';
    return best.endsWith('.') ? best : `${best}.`;
  }

  const CITY_STOP = /\b(resume|curriculum|vitae|engineer|developer|manager|analyst|designer|executive|consultant|specialist|intern|student|graduate|summary|profile|objective|skills|experience|education|linkedin|github|phone|mobile|email|portfolio)\b/i;
  function findLocation(lines, name) {
    for (const line of lines.slice(0, 5)) {
      const segs = line.split(/\s*[|•·]\s*|\s{3,}/);
      for (const seg of segs) {
        const s = seg.replace(/^(address|location)\s*[:\-]\s*/i, '').trim();
        if (!s || s === name || /[@\d/]|https?:|www\./i.test(s) || CITY_STOP.test(s)) continue;
        if (/^[A-Za-z][A-Za-z .'-]{1,30}(,\s*[A-Za-z .'-]{2,30}){0,2}$/.test(s) && s.split(/\s+/).length <= 5 && (s.includes(',') || segs.length > 1)) return s;
      }
    }
    return '';
  }

  /* ------------------------------------------------------------------ *
   * Intro writer (template based, no AI)
   * ------------------------------------------------------------------ */
  /* Skills ordered by relevance to a role: role core skills, then supporting, then the rest. */
  function pickSkills(p, role, n) {
    const def = ROLES.find((r) => r.title.toLowerCase() === String(role || '').toLowerCase());
    const have = (p.skills || []).map((s) => (typeof s === 'string' ? s : s.name));
    const ordered = [];
    const add = (x) => { if (have.includes(x) && !ordered.includes(x)) ordered.push(x); };
    if (def) { def.core.forEach(add); def.plus.forEach(add); }
    have.forEach(add);
    return ordered.slice(0, n || 6);
  }

  const FOCUS = {
    'Frontend Developer': 'building responsive, accessible and high-performance user interfaces',
    'Backend Developer': 'designing scalable APIs and reliable server-side systems',
    'Full Stack Developer': 'building complete web applications, from polished interfaces to robust APIs and databases',
    'Software Engineer': 'writing clean, well-tested and maintainable code that solves real problems',
    'Java Developer': 'building robust, scalable enterprise applications',
    'Python Developer': 'building efficient back-end services, integrations and automation',
    '.NET Developer': 'building reliable enterprise applications on the Microsoft stack',
    'Mobile App Developer': 'building smooth, user-friendly mobile apps',
    'Data Analyst': 'turning raw data into clear insights and dashboards that drive better decisions',
    'Data Scientist': 'building data-driven models that solve real business problems',
    'Machine Learning Engineer': 'building and deploying machine learning models that work reliably in production',
    'Data Engineer': 'building reliable data pipelines and scalable data platforms',
    'DevOps / Cloud Engineer': 'automating infrastructure and building dependable CI/CD pipelines',
    'QA / Test Engineer': 'ensuring product quality through thorough manual and automated testing',
    'UI/UX Designer': 'designing intuitive, user-centred digital experiences',
    'Graphic Designer': 'creating visually compelling designs that communicate clearly',
    'Cybersecurity Analyst': 'protecting systems and data by finding and fixing security risks early',
    'Network Engineer': 'designing and maintaining secure, reliable networks',
    'Embedded Systems Engineer': 'developing efficient firmware and embedded solutions',
    'Mechanical Design Engineer': 'designing and analysing mechanical components with precision',
    'Civil Engineer': 'planning and delivering safe, well-engineered construction projects',
    'Business Analyst': 'bridging business needs and technical solutions',
    'Project / Product Manager': 'delivering projects on time by aligning teams, priorities and stakeholders',
    'Digital Marketing Specialist': 'growing brands through data-driven digital campaigns',
    'Content Writer': 'writing clear, engaging content that connects with the right audience',
    'Sales / Business Development': 'building strong client relationships and consistently driving revenue',
    'Salesforce Developer': 'customising Salesforce to streamline business processes',
    'Accountant / Finance Executive': 'maintaining accurate financial records and ensuring compliance',
    'HR Executive': 'hiring great people and building positive, productive workplaces',
  };
  function focusFor(role) {
    if (FOCUS[role]) return FOCUS[role];
    const r = String(role || '').toLowerCase();
    const hit = Object.keys(FOCUS).find((k) => r.includes(k.toLowerCase().split(/[ /]/)[0]));
    return hit ? FOCUS[hit] : 'delivering high-quality work while continuously learning and improving';
  }
  const sentence = (s) => { const t = s.trim(); return t ? (/[.!?]$/.test(t) ? t : `${t}.`) : ''; };
  const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

  /**
   * facts: { name, role, experience ("4.5+ years" | "Fresher"), currentTitle, currentCompany, degree, college,
   *          skills[], certifications (string), achievement, softSkills[], hasProjects, hasInternship }
   * opts:  { length: 'short' | 'detailed' }
   */
  function writeIntro(facts, opts) {
    const f = facts || {};
    const detailed = !opts || opts.length !== 'short';
    const role = (f.role || 'professional').trim();
    const name = (f.name || '').trim();
    const iam = name ? `I am ${name},` : 'I am';
    const expText = (f.experience || '').trim();
    const years = parseFloat(expText) || 0;
    const fresher = !years || /fresher/i.test(expText);
    const skills = (f.skills || []).filter(Boolean).slice(0, 8);
    const degree = (f.degree || '').trim();
    const college = (f.college || '').trim();
    const certs = String(f.certifications || '').split(/\s*[,;]\s*/).filter(Boolean).slice(0, 2);
    const title = (f.currentTitle || '').trim();
    const company = (f.currentCompany || '').trim();
    const p1 = []; const p2 = [];

    if (!fresher) {
      let s = `${iam} ${article(role)} ${role} with ${expText.replace(/\s*(of\s+)?experience$/i, '')} of hands-on experience`;
      if (company) s += title && title.toLowerCase() !== role.toLowerCase() ? `, currently working as ${article(title)} ${title} at ${company}` : `, currently working at ${company}`;
      p1.push(sentence(s));
      if (degree) p1.push(sentence(`I hold ${article(degree)} ${degree}${college ? ` from ${college}` : ''}`));
    } else if (degree) {
      p1.push(sentence(`${iam} a recent graduate with ${article(degree)} ${degree}${college ? ` from ${college}` : ''}, and I am eager to start my career as ${article(role)} ${role}`));
    } else {
      p1.push(sentence(`${iam} an aspiring ${role}, eager to learn quickly and contribute from day one`));
    }
    if (detailed) p1.push(sentence(`I am passionate about ${focusFor(role)}`));
    if (skills.length > 4 && detailed) {
      p1.push(sentence(`My core strengths include ${listJoin(skills.slice(0, 4))}, and I am also comfortable working with ${listJoin(skills.slice(4))}`));
    } else if (skills.length) {
      p1.push(sentence(`My core skills include ${listJoin(skills)}`));
    }

    if (detailed) {
      if (f.achievement) {
        const ach = f.achievement.trim().replace(/\.$/, '');
        p2.push(sentence(STRONG_VERB.test(ach) ? `A recent highlight: I ${lcFirst(ach)}` : `A recent highlight: ${ach}`));
      }
      const bits = [];
      if (f.hasInternship && fresher) bits.push('gained real-world experience through internships');
      if (f.hasProjects) bits.push('built hands-on projects that apply these skills end to end');
      if (certs.length) bits.push(`earned certifications such as ${listJoin(certs)}`);
      if (bits.length) p2.push(sentence(`I have also ${listJoin(bits)}`));
      const soft = (f.softSkills || []).slice(0, 2).map((x) => (typeof x === 'string' ? x : x.name).toLowerCase().replace(/ skills$/, ''));
      if (soft.length) p2.push(sentence(fresher ? `I am a quick learner with strong ${listJoin(soft)} skills, and I work well in a team` : `I bring strong ${listJoin(soft)} skills and work well with cross-functional teams`));
      p2.push(sentence(fresher
        ? `I would welcome the opportunity to begin my career with your team as ${article(role)} ${role}, learn from experienced colleagues and contribute from day one`
        : `I would welcome the opportunity to bring this experience to your team as ${article(role)} ${role} and contribute to your goals from day one`));
    } else {
      p1.push(sentence(`I am confident I can add real value to your team as ${article(role)} ${role}`));
    }
    return [p1.join(' '), p2.join(' ')].filter(Boolean).join('\n\n').replace(/[ \t]+/g, ' ').trim();
  }

  /* Convenience: intro straight from an analysis result. */
  function generateIntro(p, role, chosenSkills, opts) {
    const r = role || (p.roles[0] && p.roles[0].title) || 'professional';
    return writeIntro({
      name: p.name,
      role: r,
      experience: p.experienceYears ? p.experienceLabel : 'Fresher',
      currentTitle: p.currentTitle,
      currentCompany: p.currentCompany,
      degree: p.education ? p.education.short : '',
      college: p.education ? p.education.institution : '',
      skills: chosenSkills && chosenSkills.length ? chosenSkills : pickSkills(p, r, 6),
      certifications: (p.certifications || []).join(', '),
      achievement: p.achievement,
      softSkills: p.softSkills,
      hasProjects: p.hasProjects,
      hasInternship: p.hasInternship,
    }, opts);
  }

  const api = { analyze, generateIntro, writeIntro, pickSkills, article, listJoin, fmtYears, ROLE_TITLES: ROLES.map((r) => r.title) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Analyzer = api;
})(typeof self !== 'undefined' ? self : this);
