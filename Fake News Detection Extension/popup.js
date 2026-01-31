/*
 01/25/2026
 Author: Nelson Nishio
 popup.js
 Popup script that communicates with content script and runs ML model
 */

/**
 * Porter Stemmer - NLTK Extensions Mode
 * * A JavaScript implementation of the Porter Stemming algorithm,
 * strictly following the 'NLTK_EXTENSIONS' mode logic from the 
 * Python NLTK source.
 * * Source Reference: https://github.com/nltk/nltk/blob/develop/nltk/stem/porter.py
 */
class PorterStemmer {
    constructor() {
        // NLTK Extension: Irregular forms pool
        // "This is a table of irregular forms... reflects errors actually 
        // drawn to Martin Porter's attention over a 20 year period!"
        const irregularForms = {
            "sky": ["sky", "skies"],
            "die": ["dying"],
            "lie": ["lying"],
            "tie": ["tying"],
            "news": ["news"],
            "inning": ["innings", "inning"],
            "outing": ["outings", "outing"],
            "canning": ["cannings", "canning"],
            "howe": ["howe"],
            "proceed": ["proceed"],
            "exceed": ["exceed"],
            "succeed": ["succeed"],
        };

        this.pool = {};
        // Invert the table so we can look up full words to find their stems
        for (const stem in irregularForms) {
            for (const form of irregularForms[stem]) {
                this.pool[form] = stem;
            }
        }

        this.vowels = new Set(["a", "e", "i", "o", "u"]);
    }

    isConsonant(word, i) {
        if (this.vowels.has(word[i])) return false;
        if (word[i] === "y") {
            if (i === 0) return true;
            return !this.isConsonant(word, i - 1);
        }
        return true;
    }

    measure(stem) {
        let cvSequence = "";
        for (let i = 0; i < stem.length; i++) {
            if (this.isConsonant(stem, i)) {
                cvSequence += "c";
            } else {
                cvSequence += "v";
            }
        }
        // Count 'vc' occurrences (equivalent to 'm' in the paper)
        let count = 0;
        let pos = cvSequence.indexOf("vc");
        while (pos !== -1) {
            count++;
            pos = cvSequence.indexOf("vc", pos + 1);
        }
        return count;
    }

    hasPositiveMeasure(stem) {
        return this.measure(stem) > 0;
    }

    containsVowel(stem) {
        for (let i = 0; i < stem.length; i++) {
            if (!this.isConsonant(stem, i)) return true;
        }
        return false;
    }

    endsDoubleConsonant(word) {
        return (
            word.length >= 2 &&
            word[word.length - 1] === word[word.length - 2] &&
            this.isConsonant(word, word.length - 1)
        );
    }

    endsCVC(word) {
        const len = word.length;
        // Standard Porter CVC check
        const standardCVC = (
            len >= 3 &&
            this.isConsonant(word, len - 3) &&
            !this.isConsonant(word, len - 2) &&
            this.isConsonant(word, len - 1) &&
            !["w", "x", "y"].includes(word[len - 1])
        );

        // NLTK Extension: Special CVC check for length 2 words
        const nltkCVC = (
            len === 2 &&
            !this.isConsonant(word, 0) &&
            this.isConsonant(word, 1)
        );

        return standardCVC || nltkCVC;
    }

    replaceSuffix(word, suffix, replacement) {
        if (!word.endsWith(suffix)) return word;
        if (suffix === "") return word + replacement;
        return word.slice(0, -suffix.length) + replacement;
    }

    applyRuleList(word, rules) {
        for (const rule of rules) {
            const [suffix, replacement, condition] = rule;

            // Special handling for *d rule
            if (suffix === "*d" && this.endsDoubleConsonant(word)) {
                const stem = word.slice(0, -2);
                if (!condition || condition(stem)) {
                    return stem + replacement;
                }
                return word;
            }

            if (word.endsWith(suffix)) {
                const stem = this.replaceSuffix(word, suffix, "");
                if (!condition || condition(stem)) {
                    return stem + replacement;
                }
                return word;
            }
        }
        return word;
    }

    step1a(word) {
        // NLTK Extension: 'ies' -> 'ie' if len is 4 (e.g., flies->fli but dies->die)
        if (word.endsWith("ies") && word.length === 4) {
            return this.replaceSuffix(word, "ies", "ie");
        }

        return this.applyRuleList(word, [
            ["sses", "ss", null],
            ["ies", "i", null],
            ["ss", "ss", null],
            ["s", "", null]
        ]);
    }

    step1b(word) {
        // NLTK Extension: 'ied' -> 'ie' if len is 4
        if (word.endsWith("ied")) {
            if (word.length === 4) {
                return this.replaceSuffix(word, "ied", "ie");
            } else {
                return this.replaceSuffix(word, "ied", "i");
            }
        }

        // (m>0) EED -> EE
        if (word.endsWith("eed")) {
            const stem = this.replaceSuffix(word, "eed", "");
            if (this.measure(stem) > 0) {
                return stem + "ee";
            }
            return word;
        }

        let rule2Or3Succeeded = false;
        let intermediateStem = word;

        // Check for ED or ING
        for (const suffix of ["ed", "ing"]) {
            if (word.endsWith(suffix)) {
                const tempStem = this.replaceSuffix(word, suffix, "");
                if (this.containsVowel(tempStem)) {
                    rule2Or3Succeeded = true;
                    intermediateStem = tempStem;
                    break;
                }
            }
        }

        if (!rule2Or3Succeeded) return word;

        // If ED or ING was removed, perform cleanup
        return this.applyRuleList(intermediateStem, [
            ["at", "ate", null],
            ["bl", "ble", null],
            ["iz", "ize", null],
            // (*d and not (*L or *S or *Z)) -> single letter
            ["*d", intermediateStem[intermediateStem.length - 1], (stem) => {
                const last = intermediateStem[intermediateStem.length - 1];
                return !["l", "s", "z"].includes(last);
            }],
            // (m=1 and *o) -> E
            ["", "e", (stem) => this.measure(stem) === 1 && this.endsCVC(stem)]
        ]);
    }

    step1c(word) {
        // NLTK Extension condition: y->i only if preceded by consonant AND stem > 1 char
        const nltkCondition = (stem) => {
            return stem.length > 1 && this.isConsonant(stem, stem.length - 1);
        };

        return this.applyRuleList(word, [
            ["y", "i", nltkCondition]
        ]);
    }

    step2(word) {
        // NLTK Extension: recursive 'alli' check
        // "Instead of applying the ALLI -> AL rule after '(a)bli'... we apply it first"
        if (word.endsWith("alli")) {
            const stem = this.replaceSuffix(word, "alli", "");
            if (this.hasPositiveMeasure(stem)) {
                return this.step2(this.replaceSuffix(word, "alli", "al"));
            }
        }

        const measurePos = (stem) => this.hasPositiveMeasure(stem);

        const rules = [
            ["ational", "ate", measurePos],
            ["tional", "tion", measurePos],
            ["enci", "ence", measurePos],
            ["anci", "ance", measurePos],
            ["izer", "ize", measurePos],
            ["bli", "ble", measurePos],
            ["alli", "al", measurePos],
            ["entli", "ent", measurePos],
            ["eli", "e", measurePos],
            ["ousli", "ous", measurePos],
            ["ization", "ize", measurePos],
            ["ation", "ate", measurePos],
            ["ator", "ate", measurePos],
            ["alism", "al", measurePos],
            ["iveness", "ive", measurePos],
            ["fulness", "ful", measurePos],
            ["ousness", "ous", measurePos],
            ["aliti", "al", measurePos],
            ["iviti", "ive", measurePos],
            ["biliti", "ble", measurePos],
            // NLTK Extensions specifically listed in porter.py
            ["fulli", "ful", measurePos],
            // "The 'l' of the 'logi' -> 'log' rule is put with the stem"
            ["logi", "log", (stem) => this.hasPositiveMeasure(word.slice(0, -3))]
        ];

        return this.applyRuleList(word, rules);
    }

    step3(word) {
        const measurePos = (stem) => this.hasPositiveMeasure(stem);
        return this.applyRuleList(word, [
            ["icate", "ic", measurePos],
            ["ative", "", measurePos],
            ["alize", "al", measurePos],
            ["iciti", "ic", measurePos],
            ["ical", "ic", measurePos],
            ["ful", "", measurePos],
            ["ness", "", measurePos]
        ]);
    }

    step4(word) {
        const measureGt1 = (stem) => this.measure(stem) > 1;
        return this.applyRuleList(word, [
            ["al", "", measureGt1],
            ["ance", "", measureGt1],
            ["ence", "", measureGt1],
            ["er", "", measureGt1],
            ["ic", "", measureGt1],
            ["able", "", measureGt1],
            ["ible", "", measureGt1],
            ["ant", "", measureGt1],
            ["ement", "", measureGt1],
            ["ment", "", measureGt1],
            ["ent", "", measureGt1],
            // (m>1 and (*S or *T)) ION ->
            ["ion", "", (stem) => this.measure(stem) > 1 && ["s", "t"].includes(stem[stem.length - 1])],
            ["ou", "", measureGt1],
            ["ism", "", measureGt1],
            ["ate", "", measureGt1],
            ["iti", "", measureGt1],
            ["ous", "", measureGt1],
            ["ive", "", measureGt1],
            ["ize", "", measureGt1]
        ]);
    }

    step5a(word) {
        if (word.endsWith("e")) {
            const stem = this.replaceSuffix(word, "e", "");
            const m = this.measure(stem);
            if (m > 1) return stem;
            if (m === 1 && !this.endsCVC(stem)) return stem;
        }
        return word;
    }

    step5b(word) {
        // (m > 1 and *d and *L) -> single letter
        return this.applyRuleList(word, [
            ["ll", "l", (stem) => this.measure(word.slice(0, -1)) > 1]
        ]);
    }

    stem(word) {
        const w = word.toLowerCase();

        // NLTK Extension: Check pool first
        if (this.pool[w]) return this.pool[w];

        // NLTK Extension: Words <= 2 chars are not stemmed
        // "With this line, strings of length 1 or 2 don't go through the stemming process"
        if (w.length <= 2) return w;

        let stem = this.step1a(w);
        stem = this.step1b(stem);
        stem = this.step1c(stem);
        stem = this.step2(stem);
        stem = this.step3(stem);
        stem = this.step4(stem);
        stem = this.step5a(stem);
        stem = this.step5b(stem);

        return stem;
    }
}

// English stopwords (same as NLTK)
const STOPWORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', "you're",
  "you've", "you'll", "you'd", 'your', 'yours', 'yourself', 'yourselves', 'he',
  'him', 'his', 'himself', 'she', "she's", 'her', 'hers', 'herself', 'it', "it's",
  'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which',
  'who', 'whom', 'this', 'that', "that'll", 'these', 'those', 'am', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do',
  'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because',
  'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
  'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can',
  'will', 'just', 'don', "don't", 'should', "should've", 'now', 'd', 'll', 'm',
  'o', 're', 've', 'y', 'ain', 'aren', "aren't", 'couldn', "couldn't", 'didn',
  "didn't", 'doesn', "doesn't", 'hadn', "hadn't", 'hasn', "hasn't", 'haven',
  "haven't", 'isn', "isn't", 'ma', 'mightn', "mightn't", 'mustn', "mustn't",
  'needn', "needn't", 'shan', "shan't", 'shouldn', "shouldn't", 'wasn', "wasn't",
  'weren', "weren't", 'won', "won't", 'wouldn', "wouldn't"
]);

// Text preprocessing matching your Python pipeline
function stemming(content) {
  // Remove non-alphabetic characters (matching re.sub('[^a-zA-Z]',' ',content))
  let processed = content.replace(/[^a-zA-Z]/g, ' ');
  
  // Convert to lowercase
  processed = processed.toLowerCase();
  
  // Split into words
  let words = processed.split(/\s+/).filter(word => word.length > 0);
  const stemmer = new PorterStemmer();
  // Remove stopwords and apply stemming
  words = words
    .filter(word => !STOPWORDS.has(word))
    .map(word => stemmer.stem(word));  // Use the reference stemmer
  
  // Join back into string
  return words.join(' ');
}

// Simple TF-IDF vectorizer
class SimpleTFIDF {
  constructor(vocabulary, idfValues) {
    this.vocabulary = vocabulary;
    this.idfValues = idfValues;
    this.vocabMap = new Map();
    vocabulary.forEach((word, idx) => {
      this.vocabMap.set(word, idx);
    });
  }
  
  transform(text) {
    // 1. Preprocess text
    const processedText = stemming(text);
    const tokens = processedText.split(/\s+/).filter(token => token.length > 0);
    
    // 2. Calculate Term Frequency (Raw Count)
    // Scikit-learn default is Raw Count, NOT frequency (count/length)
    const termCounts = new Map();
    tokens.forEach(token => {
      termCounts.set(token, (termCounts.get(token) || 0) + 1);
    });
    
    // 3. Create Raw TF-IDF Vector
    const features = new Array(this.vocabulary.length).fill(0);
    let sumSquares = 0;

    termCounts.forEach((count, word) => {
      const idx = this.vocabMap.get(word);
      if (idx !== undefined) {
        // TF (Raw Count) * IDF
        const val = count * this.idfValues[idx];
        features[idx] = val;
        sumSquares += val * val;
      }
    });

    // 4. Apply L2 Normalization
    // (Divide vector by its Euclidean norm)
    if (sumSquares > 0) {
      const norm = Math.sqrt(sumSquares);
      for (let i = 0; i < features.length; i++) {
        features[i] = features[i] / norm;
      }
    }
    
    return features;
  }
}

// Logistic Regression predictor
class LogisticRegression {
  constructor(coefficients, intercept) {
    this.coef = coefficients;
    this.intercept = intercept;
  }
  
  predict(features) {
    // Calculate dot product + intercept
    let score = this.intercept;
    for (let i = 0; i < features.length; i++) {
      score += features[i] * this.coef[i];
    }
    
    // Apply sigmoid
    const probability = 1 / (1 + Math.exp(-score));
    
    return {
      prediction: probability > 0.5 ? 1 : 0,
      confidence: probability > 0.5 ? probability : 1 - probability,
      fakeProbability: probability,
      realProbability: 1 - probability
    };
  }
}

// Load model parameters
async function loadModel() {
  try {
    const response = await fetch(chrome.runtime.getURL('model/model_params.json'));
    const modelData = await response.json();
    
    const vectorizer = new SimpleTFIDF(
      modelData.vocabulary,
      modelData.idf_values
    );
    
    const model = new LogisticRegression(
      modelData.coefficients,
      modelData.intercept
    );
    
    return { vectorizer, model };
  } catch (error) {
    console.error('Error loading model:', error);
    return null;
  }
}

function displayResult(isArticle, prediction = null, articleData = null) {
  const resultDiv = document.getElementById('result');
  
  if (!isArticle) {
    resultDiv.innerHTML = `
      <div class="status not-article">
        ⚠️ This doesn't appear to be a news article
      </div>
    `;
    return;
  }
  
  if (!prediction) {
    resultDiv.innerHTML = `
      <div class="status loading">
        🔄 Analyzing article...
      </div>
    `;
    return;
  }
  
  const isFake = prediction.prediction === 1;
  const confidence = (prediction.confidence * 100).toFixed(1);
  const fakeProb = (prediction.fakeProbability * 100).toFixed(1);
  const realProb = (prediction.realProbability * 100).toFixed(1);
  
  let statusClass, emoji, label;
  
  if (prediction.confidence < 0.6) {
    statusClass = 'uncertain';
    emoji = '⚠️';
    label = 'Uncertain';
  } else if (isFake) {
    statusClass = 'fake-news';
    emoji = '❌';
    label = 'Likely Fake News';
  } else {
    statusClass = 'real-news';
    emoji = '✅';
    label = 'Likely Reliable';
  }
  
  resultDiv.innerHTML = `
    <div class="status ${statusClass}">
      <div>${emoji} ${label}</div>
      <div class="confidence">
        Confidence: ${confidence}%
      </div>
    </div>
    
    <div class="confidence">
      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
        <span>Real: ${realProb}%</span>
        <span>Fake: ${fakeProb}%</span>
      </div>
      <div class="confidence-bar">
        <div class="confidence-fill ${isFake ? 'fake-fill' : 'real-fill'}" 
             style="width: ${Math.max(realProb, fakeProb)}%">
        </div>
      </div>
    </div>
    
    <div class="details">
      <small>Note: This is an automated prediction and may not be accurate. Always verify information from multiple sources.</small>
    </div>
  `;
}

async function analyzeArticle() {
  const analyzeBtn = document.getElementById('analyzeBtn');
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing...';
  
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Send message to content script
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'checkArticle' });
    
    if (!response.isArticle) {
      displayResult(false);
      return;
    }
    
    displayResult(true, null);
    
    // Load model and make prediction
    const modelComponents = await loadModel();
    
    if (!modelComponents) {
      throw new Error('Failed to load model');
    }
    
    const { vectorizer, model } = modelComponents;
    
    console.log('=== JAVASCRIPT CALCULATION ===');
    console.log('Original text length:', response.data.text.length);
    console.log('Original text:', response.data.text);
    
    // Detailed preprocessing debugging
    console.log('\n=== PREPROCESSING STEPS ===');
    
    // Step 1: Remove non-alphabetic
    let step1 = response.data.text.replace(/[^a-zA-Z]/g, ' ');
    console.log('Step 1 - Remove non-alpha:', step1.length, 'chars');
    
    // Step 2: Lowercase
    let step2 = step1.toLowerCase();
    console.log('Step 2 - Lowercase:', step2.length, 'chars');
    
    // Step 3: Split
    let step3 = step2.split(/\s+/).filter(w => w.length > 0);
    console.log('Step 3 - Split:', step3.length, 'words');
    console.log('First 20 words:', step3.slice(0, 20));
    
    // Step 4: Remove stopwords and stem
    let beforeStopwords = step3.length;
    let step4 = step3.filter(word => !STOPWORDS.has(word));
    let afterStopwords = step4.length;
    console.log('Step 4 - After stopword removal:', afterStopwords, 'words (removed:', beforeStopwords - afterStopwords, ')');
    const stemmer = new PorterStemmer();
    let step5 = step4.map(word => stemmer.stem(word));  // Use reference stemmer
    console.log('Step 5 - After stemming:', step5.length, 'words');
    console.log('First 20 processed words:', step5.slice(0, 20));
    
    // Test specific words
    const testWords = ['reporting', 'reported', 'reporter', 'reports', 'additionally', 'additional'];
    console.log('\nStemming test:');
    testWords.forEach(word => {
      const stemmed = stemmer.stem(word);  // Use reference stemmer
      const isStop = STOPWORDS.has(word);
      console.log(`  ${word} → ${stemmed} (stopword: ${isStop})`);
    });
    
    // Preprocess text using the function
    const processedText = stemming(response.data.text);
    const words = processedText.split(/\s+/).filter(w => w.length > 0);
    console.log('\nFinal processed text (first 200 chars):', processedText.substring(0, 200));
    console.log('Final word count:', words.length);
    console.log('===========================');
    
    // Vectorize text (preprocessing is done inside transform)
    const features = vectorizer.transform(response.data.text);
    
    const nonZeroCount = features.filter(f => f > 0).length;
    console.log('\nVocabulary size:', vectorizer.vocabulary.length);
    console.log('Non-zero features:', nonZeroCount);
    
    // Get top features for debugging
    const topFeatures = features
      .map((val, idx) => ({word: vectorizer.vocabulary[idx], val, idx, coef: model.coef[idx]}))
      .filter(f => f.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 20);
    
    console.log('\nTop 20 features with contributions:');
    topFeatures.forEach(f => {
      const contribution = f.val * f.coef;
      console.log(`  ${f.word.padEnd(20)} | TF-IDF: ${f.val.toFixed(8)} | Coef: ${f.coef >= 0 ? '+' : ''}${f.coef.toFixed(8)} | Contrib: ${contribution >= 0 ? '+' : ''}${contribution.toFixed(8)}`);
    });
    
    // Make prediction
    const prediction = model.predict(features);
    
    // Calculate raw score manually for debugging
    let rawScore = model.intercept;
    let totalContribution = 0;
    for (let i = 0; i < features.length; i++) {
      if (features[i] > 0) {
        const contrib = features[i] * model.coef[i];
        totalContribution += contrib;
        rawScore += contrib;
      }
    }
    
    console.log('\n=== PREDICTION BREAKDOWN ===');
    console.log('Intercept:', model.intercept.toFixed(8));
    console.log('Total feature contribution:', totalContribution.toFixed(8));
    console.log('Raw score (before sigmoid):', rawScore.toFixed(8));
    console.log('After sigmoid:', prediction.fakeProbability.toFixed(8));
    console.log('\nProbability Real:', prediction.realProbability.toFixed(6), `(${(prediction.realProbability * 100).toFixed(2)}%)`);
    console.log('Probability Fake:', prediction.fakeProbability.toFixed(6), `(${(prediction.fakeProbability * 100).toFixed(2)}%)`);
    console.log('\nFinal prediction:', prediction.prediction === 1 ? 'FAKE' : 'REAL');
    console.log('===========================');
    
    // Export for comparison
    console.log('\n📋 COPY THIS FOR PYTHON COMPARISON:');
    console.log(JSON.stringify({
      non_zero_features: nonZeroCount,
      intercept: model.intercept,
      raw_score: rawScore,
      prob_fake: prediction.fakeProbability,
      prob_real: prediction.realProbability,
      prediction: prediction.prediction
    }, null, 2));
    
    // Display result
    displayResult(true, prediction, response.data);
    
  } catch (error) {
    console.error('Error analyzing article:', error);
    document.getElementById('result').innerHTML = `
      <div class="status not-article">
        ❌ Error: ${error.message}
      </div>
    `;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze Article';
  }
}

// Auto-analyze on popup open
document.addEventListener('DOMContentLoaded', analyzeArticle);

// Manual analyze button
document.getElementById('analyzeBtn').addEventListener('click', analyzeArticle);