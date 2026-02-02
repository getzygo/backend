/**
 * Slug Validation Utilities
 *
 * Shared validation for tenant workspace slugs/subdomains.
 * Used by signup and tenant services.
 */

/**
 * Validate slug format
 * - Lowercase alphanumeric with hyphens
 * - 3-50 characters
 * - Cannot start or end with hyphen
 */
export function isValidSlug(slug: string): boolean {
  const slugRegex = /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/;
  return slugRegex.test(slug);
}

/**
 * Check if slug is reserved or contains blocked content
 * Includes: official terms, infrastructure, offensive content
 */
export function isBlockedSlug(slug: string): boolean {
  const normalizedSlug = slug.toLowerCase();

  // Official Zygo & corporate terms (could be confused as official)
  const officialTerms = [
    'zygo', 'getzygo', 'zygotech', 'zygo-tech', 'zygoapp', 'zygo-app',
    'zygoai', 'zygo-ai', 'zygoteam', 'zygo-team', 'zygoofficial',
    'admin', 'administrator', 'app', 'apps', 'corp', 'corporate',
    'official', 'team', 'teams', 'staff', 'employee', 'employees',
    'internal', 'company', 'enterprise', 'business', 'headquarters', 'hq',
    'ceo', 'cto', 'cfo', 'coo', 'founder', 'founders', 'executive',
    'management', 'hr', 'legal', 'finance', 'sales', 'marketing',
    'engineering', 'product', 'operations', 'security', 'compliance',
  ];

  // Technical & infrastructure terms
  const technicalTerms = [
    'api', 'api-v1', 'api-v2', 'graphql', 'rest', 'webhook', 'webhooks',
    'www', 'web', 'mobile', 'ios', 'android', 'desktop',
    'get', 'post', 'put', 'patch', 'delete', 'head', 'options', // HTTP methods
    'help', 'support', 'contact', 'feedback', 'report', 'abuse',
    'blog', 'news', 'press', 'media', 'docs', 'documentation', 'wiki',
    'status', 'health', 'ping', 'metrics', 'monitor', 'monitoring',
    'mail', 'email', 'smtp', 'imap', 'ftp', 'sftp', 'ssh', 'ssl', 'cdn',
    'test', 'testing', 'dev', 'develop', 'development', 'stage', 'staging',
    'prod', 'production', 'live', 'release', 'beta', 'alpha', 'preview',
    'auth', 'oauth', 'sso', 'saml', 'login', 'logout', 'signin', 'signout',
    'signup', 'register', 'registration', 'onboarding', 'verify', 'confirm',
    'account', 'accounts', 'profile', 'profiles', 'user', 'users',
    'settings', 'config', 'configuration', 'preferences', 'options',
    'billing', 'payment', 'payments', 'subscribe', 'subscription', 'pricing',
    'dashboard', 'console', 'panel', 'portal', 'control',
    'demo', 'trial', 'free', 'premium', 'pro', 'plus', 'basic', 'starter',
    'root', 'null', 'undefined', 'admin', 'superuser', 'system', 'sysadmin',
    'localhost', 'local', 'server', 'servers', 'node', 'nodes', 'cluster',
    'database', 'db', 'cache', 'redis', 'postgres', 'mysql', 'mongo',
    'static', 'assets', 'images', 'img', 'files', 'uploads', 'downloads',
    'public', 'private', 'shared', 'common', 'default', 'example', 'sample',
  ];

  // Profanity & vulgar terms
  const profanity = [
    'fuck', 'fucker', 'fucking', 'fucked', 'fucks', 'fck', 'f-ck', 'fuk',
    'shit', 'shits', 'shitty', 'bullshit', 'horseshit', 'sh1t', 'sht',
    'ass', 'asses', 'asshole', 'assholes', 'arsehole', 'arse',
    'bitch', 'bitches', 'bitchy', 'b1tch', 'biatch',
    'bastard', 'bastards', 'cunt', 'cunts', 'c-nt',
    'damn', 'damned', 'dammit', 'goddamn', 'goddamnit',
    'dick', 'dicks', 'dickhead', 'cock', 'cocks', 'cocksucker',
    'piss', 'pissed', 'pissing', 'crap', 'crappy',
    'whore', 'whores', 'slut', 'sluts', 'slutty', 'hoe', 'hoes',
    'wanker', 'wankers', 'twat', 'twats', 'douche', 'douchebag',
    'moron', 'idiot', 'idiots', 'retard', 'retarded', 'retards',
  ];

  // Sexual content
  const sexualTerms = [
    'sex', 'sexy', 'sexual', 'sexo', 'xxx', 'xxxx', 'porn', 'porno',
    'pornography', 'pornhub', 'xvideos', 'xhamster', 'redtube',
    'nude', 'nudes', 'naked', 'nsfw', 'adult', 'adults-only',
    'erotic', 'erotica', 'fetish', 'kink', 'kinky', 'bdsm',
    'orgasm', 'orgasms', 'masturbate', 'masturbation', 'jerkoff',
    'dildo', 'vibrator', 'penis', 'vagina', 'boobs', 'boobies', 'tits',
    'titties', 'nipple', 'nipples', 'pussy', 'pussies', 'anal',
    'blowjob', 'handjob', 'cumshot', 'cum', 'semen', 'sperm',
    'hooker', 'hookers', 'escort', 'escorts', 'prostitute', 'brothel',
    'stripper', 'strippers', 'camgirl', 'camgirls', 'onlyfans',
  ];

  // Racist, discriminatory & hate terms
  const hateSpeech = [
    'nigger', 'niggers', 'nigga', 'niggas', 'n1gger', 'n1gga',
    'chink', 'chinks', 'gook', 'gooks', 'spic', 'spics', 'wetback',
    'kike', 'kikes', 'jew-hater', 'jewkiller',
    'faggot', 'faggots', 'fag', 'fags', 'f4g', 'f4ggot', 'dyke', 'dykes',
    'tranny', 'trannies', 'shemale', 'ladyboy',
    'beaner', 'beaners', 'cracker', 'crackers', 'honky', 'honkey',
    'towelhead', 'raghead', 'sandnigger', 'camel-jockey',
    'redskin', 'redskins', 'injun', 'squaw',
    'nazi', 'nazis', 'neonazi', 'neo-nazi', 'hitler', 'hitlerite',
    'fascist', 'fascists', 'fascism', 'whitesupremacy', 'whitepower',
    'kkk', 'klan', 'ku-klux', 'kuklux', 'skinhead', 'skinheads',
    'aryan', 'aryans', 'aryannation', 'whiterace', 'racewar',
    'heil', 'sieg-heil', 'siegheil', 'swastika', 'ss', 'gestapo',
    'holocaust', 'holocaustdenier', 'antisemite', 'antisemitic',
    'jihad', 'jihadist', 'isis', 'alqaeda', 'al-qaeda', 'taliban', 'terrorist',
    'genocide', 'ethnic-cleansing', 'ethniccleansing',
  ];

  // Violence & harmful content
  const violentTerms = [
    'kill', 'killer', 'killers', 'killing', 'murder', 'murderer',
    'suicide', 'suicidal', 'selfharm', 'self-harm', 'cutmyself',
    'rape', 'rapist', 'raping', 'molest', 'molester', 'pedophile',
    'pedo', 'pedos', 'childporn', 'cp', 'lolita', 'underage',
    'bomb', 'bomber', 'bombing', 'terrorist', 'terrorism', 'terror',
    'shoot', 'shooter', 'shooting', 'massacre', 'massmurder',
    'torture', 'torturer', 'torturing', 'abuse', 'abuser', 'abusing',
    'kidnap', 'kidnapper', 'kidnapping', 'traffick', 'trafficking',
    'hitman', 'assassin', 'assassination', 'execute', 'execution',
    'die', 'death', 'deadbody', 'corpse', 'gore', 'gory', 'snuff',
  ];

  // Drug-related terms
  const drugTerms = [
    'cocaine', 'coke', 'heroin', 'heroine', 'meth', 'methamphetamine',
    'crack', 'crackhead', 'lsd', 'acid', 'ecstasy', 'mdma', 'molly',
    'weed', 'marijuana', 'cannabis', 'pot', 'stoner', 'drugdealer',
    'dealer', 'cartel', 'narco', 'narcos', 'drugtraffic', 'overdose',
    'junkie', 'junkies', 'addict', 'addicts', 'dope', 'dopehead',
  ];

  // Combine all blocked terms
  const allBlocked = [
    ...officialTerms,
    ...technicalTerms,
    ...profanity,
    ...sexualTerms,
    ...hateSpeech,
    ...violentTerms,
    ...drugTerms,
  ];

  // Check exact match
  if (allBlocked.includes(normalizedSlug)) {
    return true;
  }

  // Check if slug contains any dangerous term as substring
  // This catches variations like "my-nazi-company" or "sexygirls"
  const dangerousTerms = [...profanity, ...sexualTerms, ...hateSpeech, ...violentTerms];
  for (const term of dangerousTerms) {
    if (normalizedSlug.includes(term)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the reason why a slug is blocked (for error messages)
 */
export function getSlugBlockReason(slug: string): string | null {
  if (!isValidSlug(slug)) {
    return 'Invalid format. Use lowercase letters, numbers, and hyphens only (3-50 characters).';
  }

  if (isBlockedSlug(slug)) {
    return 'This workspace URL is not available. Please choose another.';
  }

  return null;
}
