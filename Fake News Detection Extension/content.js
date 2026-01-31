/*
 01/25/2026
 Author: Nelson Nishio
 content.js
 Content script that detects articles and extracts text
*/
function isNewsArticle() {
  // Check for common article indicators
  const articleSelectors = [
    'article',
    '[role="article"]',
    '.article',
    '.post-content',
    '.entry-content',
    'main article'
  ];
  
  // Check if page has article elements
  const hasArticleElement = articleSelectors.some(sel => 
    document.querySelector(sel) !== null
  );
  
  // Check for article schema
  const hasArticleSchema = document.querySelector(
    'script[type="application/ld+json"]'
  )?.textContent?.includes('"@type":"NewsArticle"') || 
  document.querySelector(
    'script[type="application/ld+json"]'
  )?.textContent?.includes('"@type":"Article"');
  
  // Check meta tags
  const ogType = document.querySelector('meta[property="og:type"]')?.content;
  const isArticleType = ogType === 'article';
  
  return hasArticleElement || hasArticleSchema || isArticleType;
}

function extractArticleText() {
  console.log('Starting article extraction...');
  
  // Try to find article content using multiple strategies
  let articleElement = null;
  let strategy = 'unknown';
  
  // Strategy 1: Site-specific selectors (most reliable)
  const siteSpecificSelectors = {
    'reuters.com': [
      '[data-testid="paragraph-0"]', // Reuters uses data-testid for paragraphs
      '.article-body__content__17Yit',
      '.StandardArticleBody_body',
      'article[data-testid="article-content"]'
    ],
    'cnn.com': [
      '.article__content',
      '.zn-body__paragraph'
    ],
    'bbc.com': [
      '[data-component="text-block"]',
      '.article__body-content'
    ],
    'nytimes.com': [
      '.StoryBodyCompanionColumn',
      'section[name="articleBody"]'
    ],
    'washingtonpost.com': [
      '.article-body',
      '[data-qa="article-body"]'
    ],
    'theguardian.com': [
      '.article-body-commercial-selector',
      '[data-gu-name="body"]'
    ],
    'apnews.com': [
      '.Article',
      '.RichTextStoryBody'
    ]
  };
  
  // Detect site
  const hostname = window.location.hostname.replace('www.', '');
  const siteSelectors = siteSpecificSelectors[hostname] || [];
  
  for (const selector of siteSelectors) {
    articleElement = document.querySelector(selector);
    if (articleElement) {
      strategy = `site-specific: ${selector}`;
      console.log('Found article using:', strategy);
      break;
    }
  }
  
  // Strategy 2: Common semantic selectors
  if (!articleElement) {
    const semanticSelectors = [
      '[itemprop="articleBody"]',
      '.article-body',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.story-body',
      '.article__body',
      '.content-body'
    ];
    
    for (const selector of semanticSelectors) {
      articleElement = document.querySelector(selector);
      if (articleElement) {
        strategy = `semantic: ${selector}`;
        console.log('Found article using:', strategy);
        break;
      }
    }
  }
  
  // Strategy 3: Find article tag
  if (!articleElement) {
    articleElement = document.querySelector('article');
    if (articleElement) {
      strategy = 'article tag';
      console.log('Found article using: article tag');
    }
  }
  
  // Strategy 4: Last resort - main or body
  if (!articleElement) {
    articleElement = document.querySelector('main') || document.body;
    strategy = 'fallback';
    console.log('Using fallback:', articleElement.tagName);
  }
  
  // For Reuters specifically, try to get all paragraph elements
  let paragraphs = [];
  
  if (hostname === 'reuters.com') {
    // Reuters uses data-testid="paragraph-N" for each paragraph
    const allParagraphs = document.querySelectorAll('[data-testid^="paragraph-"]');
    if (allParagraphs.length > 0) {
      paragraphs = Array.from(allParagraphs);
      console.log(`Found ${paragraphs.length} Reuters paragraphs`);
    }
  }
  
  // If no paragraphs found yet, search within article element
  if (paragraphs.length === 0 && articleElement) {
    paragraphs = Array.from(articleElement.querySelectorAll('p'));
    console.log(`Found ${paragraphs.length} paragraphs in article element`);
  }
  
  // If still no paragraphs, search entire document
  if (paragraphs.length === 0) {
    paragraphs = Array.from(document.querySelectorAll('p'));
    console.log(`Found ${paragraphs.length} paragraphs in entire document`);
  }
  
  // Filter out unwanted paragraphs
  const filteredParagraphs = paragraphs.filter(p => {
    const text = p.textContent.trim();
    const textLower = text.toLowerCase();
    
    // Skip very short paragraphs (likely not article content)
    if (text.length < 30) return false;
    
    // Skip common non-content patterns
    if (textLower.startsWith('share') ||
        textLower.startsWith('follow') ||
        textLower.startsWith('subscribe') ||
        textLower.startsWith('sign up') ||
        textLower.startsWith('read more') ||
        textLower.startsWith('click here') ||
        textLower.startsWith('advertisement') ||
        textLower.includes('cookie') && textLower.includes('policy') ||
        textLower.includes('privacy policy') ||
        textLower.includes('terms of service')) {
      return false;
    }
    
    // Skip reporting/editing credits (common at end of articles)
    if (textLower.match(/^(reporting|additional reporting|writing|editing) by/i)) {
      return false;
    }
    
    // Skip "our standards" footers
    if (textLower.includes('our standards:') || 
        textLower.includes('trust principles')) {
      return false;
    }
    
    // Skip if parent is in navigation/header/footer
    let parent = p.parentElement;
    let depth = 0;
    while (parent && depth < 5) {
      const tagName = parent.tagName.toLowerCase();
      const className = parent.className.toLowerCase();
      
      if (tagName === 'nav' || 
          tagName === 'header' || 
          tagName === 'footer' || 
          tagName === 'aside' ||
          className.includes('nav') ||
          className.includes('menu') ||
          className.includes('sidebar') ||
          className.includes('related') ||
          className.includes('recommend')) {
        return false;
      }
      parent = parent.parentElement;
      depth++;
    }
    
    return true;
  });
  
  console.log(`Filtered to ${filteredParagraphs.length} valid paragraphs`);
  
  // Extract text from filtered paragraphs
  const mainText = filteredParagraphs
    .map(p => p.textContent.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  console.log('=== EXTRACTION RESULTS ===');
  console.log('Strategy used:', strategy);
  console.log('Text length:', mainText.length);
  console.log('Paragraphs used:', filteredParagraphs.length);
  console.log('First 300 chars:', mainText.substring(0, 300));
  console.log('========================');
  
  // Validation - if text is too short, something went wrong
  if (mainText.length < 200) {
    console.warn('WARNING: Extracted text is very short. Extraction may have failed.');
    console.warn('Trying alternative extraction method...');
    
    // Alternative: get all text from article element, remove unwanted
    if (articleElement) {
      const clone = articleElement.cloneNode(true);
      
      // Remove unwanted elements
      clone.querySelectorAll('script, style, nav, header, footer, aside, button, form, input').forEach(el => el.remove());
      
      const alternativeText = clone.textContent
        .replace(/\s+/g, ' ')
        .trim();
      
      if (alternativeText.length > mainText.length) {
        console.log('Alternative extraction found more text:', alternativeText.length, 'chars');
        return {
          text: alternativeText.substring(0, 10000),
          fullText: alternativeText,
          url: window.location.href
        };
      }
    }
  }
  
  return {
    text: mainText.substring(0, 10000),
    fullText: mainText,
    url: window.location.href
  };
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkArticle') {
    const isArticle = isNewsArticle();
    
    if (isArticle) {
      const articleData = extractArticleText();
      sendResponse({
        isArticle: true,
        data: articleData
      });
    } else {
      sendResponse({
        isArticle: false
      });
    }
  }
  return true;
});