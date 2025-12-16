/**
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Text within these html tags will be excluded from passages by default.
const _DEFAULT_HTML_TAGS_TO_EXCLUDE = new Set(["noscript", "script", "style"]);

// Html tags that indicate a section break. Sibling nodes will not be
// greedily-aggregated into a chunk across one of these tags.
const _SECTION_BREAK_HTML_TAGS = new Set([
  "article",
  "br",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "footer",
  "header",
  "main",
  "nav",
]);

class PassageList {
  constructor() {
    this.passages = [];
  }

  /**
   * Adds a text passage for the input node.
   * @param {AggregateNode} node
   */
  addPassageForNode(node) {
    const passage = node.createPassage();
    if (passage) {
      this.passages.push(passage);
    }
  }

  /**
   * Extends this PassageList with the input passage_list.
   * @param {PassageList} passageList
   */
  extend(passageList) {
    // In JS, we spread the array to push multiple items
    this.passages.push(...passageList.passages);
  }
}

class AggregateNode {
  /**
   * Contains aggregate information about a node and its descendants.
   */
  constructor() {
    this.htmlTag = null;
    this.segments = [];
    this.numWords = 0;
    this.passageList = new PassageList();
  }

  /**
   * Returns true if the input node can be added to this AggregateNode without exceeding max_words.
   * @param {AggregateNode} node
   * @param {number} maxWords
   * @returns {boolean}
   */
  fits(node, maxWords) {
    return this.numWords + node.numWords <= maxWords;
  }

  /**
   * Adds the input node to this AggregateNode.
   * @param {AggregateNode} node
   */
  addNode(node) {
    if (!node.segments || node.segments.length === 0) {
      return;
    }
    this.numWords += node.numWords;
    this.segments.push(...node.segments);
  }

  /**
   * Creates and returns a text passage for this AggregateNode.
   * @returns {string}
   */
  createPassage() {
    // filter(Boolean) removes empty strings
    const cleanSegments = this.segments.filter(Boolean);
    return cleanSegments.join(" ");
  }

  /**
   * Returns a list of text passages for this AggregateNode.
   * @returns {string[]}
   */
  getPassages() {
    return this.passageList.passages;
  }
}

class HtmlChunker {
  /**
   * Chunks html documents into text passages.
   * * @param {object} config
   * @param {number} config.maxWordsPerAggregatePassage Maximum number of words in a passage comprised of multiple html nodes.
   * @param {boolean} config.greedilyAggregateSiblingNodes If true, sibling html nodes are greedily aggregated.
   * @param {Set<string>} [config.htmlTagsToExclude] Text within tags in this set will not be included.
   * @param {Set<string>} [config.htmlClassesToExclude] Text within classes in this set will not be included.
   */
  constructor({
    maxWordsPerAggregatePassage,
    greedilyAggregateSiblingNodes,
    htmlTagsToExclude = _DEFAULT_HTML_TAGS_TO_EXCLUDE,
    htmlClassesToExclude = new Set(),
  }) {
    this.maxWordsPerAggregatePassage = maxWordsPerAggregatePassage;
    this.greedilyAggregateSiblingNodes = greedilyAggregateSiblingNodes;

    // Normalize tags to lowercase for comparison
    this.htmlTagsToExclude = new Set(
      [...htmlTagsToExclude].map((tag) => tag.trim().toLowerCase()),
    );
    this.htmlClassesToExclude = new Set(
      [...htmlClassesToExclude].map((cls) => cls.trim().toLowerCase()),
    );
  }

  /**
   * Helper to count words in a string similarly to Python's len(str.split())
   * @param {string} text
   * @returns {number}
   */
  _countWords(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  }

  /**
   * Recursively processes a node and its descendants.
   * @param {Node} node DOM Node
   * @returns {AggregateNode}
   */
  _processNode(node) {
    const currentNode = new AggregateNode();

    if (node.nodeName) {
      currentNode.htmlTag = node.nodeName.toLowerCase();
    }

    // Check exclusions
    const isElement = node.nodeType === Node.ELEMENT_NODE;
    const tagName = isElement ? node.tagName.toLowerCase() : "";

    // Check for classes to exclude
    let hasExcludedClass = false;
    if (isElement && node.classList && node.classList.length > 0) {
      for (const cls of node.classList) {
        if (this.htmlClassesToExclude.has(cls.toLowerCase())) {
          hasExcludedClass = true;
          break;
        }
      }
    }

    if (
      (isElement && this.htmlTagsToExclude.has(tagName)) ||
      node.nodeType === Node.COMMENT_NODE ||
      (isElement && hasExcludedClass)
    ) {
      return currentNode;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      // Store the text for this leaf node.
      // Unlike BeautifulSoup, DOM text nodes are leaves.
      const text = node.textContent;
      // Skip text directly under #document (not typical in standard DOM traversal but good safety)
      if (node.parentNode && node.parentNode.nodeName !== "#document") {
        currentNode.numWords = this._countWords(text);
        if (text.trim()) {
          currentNode.segments.push(text.trim());
        }
      }
      return currentNode;
    }

    // Will hold the aggregate of this node and all its unchunked descendants
    const currentAggregatingNode = new AggregateNode();

    // Holds the current greedy aggregate
    let currentGreedyAggregatingNode = new AggregateNode();

    let shouldAggregateCurrentNode = true;
    const passageList = new PassageList();

    const children = Array.from(node.childNodes);

    for (const child of children) {
      const childNode = this._processNode(child);

      if (childNode.getPassages().length > 0) {
        shouldAggregateCurrentNode = false;

        if (this.greedilyAggregateSiblingNodes) {
          passageList.addPassageForNode(currentGreedyAggregatingNode);
          currentGreedyAggregatingNode = new AggregateNode();
        }
        passageList.extend(childNode.passageList);
      } else {
        currentAggregatingNode.addNode(childNode);

        if (this.greedilyAggregateSiblingNodes) {
          const isSectionBreak =
            childNode.htmlTag &&
            _SECTION_BREAK_HTML_TAGS.has(childNode.htmlTag);

          if (
            !isSectionBreak &&
            currentGreedyAggregatingNode.fits(
              childNode,
              this.maxWordsPerAggregatePassage,
            )
          ) {
            currentGreedyAggregatingNode.addNode(childNode);
          } else {
            passageList.addPassageForNode(currentGreedyAggregatingNode);
            // In Python: current_greedy_aggregating_node = child_node
            // We can just set the variable to the childNode instance as the new base
            currentGreedyAggregatingNode = childNode;
          }
        } else {
          passageList.addPassageForNode(childNode);
        }
      }
    }

    if (this.greedilyAggregateSiblingNodes) {
      passageList.addPassageForNode(currentGreedyAggregatingNode);
    }

    // If we should not or cannot aggregate this node, add passages for this node
    // and its descendant passages.
    if (
      !shouldAggregateCurrentNode ||
      !currentNode.fits(
        currentAggregatingNode,
        this.maxWordsPerAggregatePassage,
      )
    ) {
      currentNode.passageList.addPassageForNode(currentNode); // Often empty at this stage if it's a container
      currentNode.passageList.extend(passageList);
      return currentNode;
    }

    // Add this node to the aggregate.
    currentNode.addNode(currentAggregatingNode);
    return currentNode;
  }

  /**
   * Chunks the html into text passages.
   * @param {string} html HTML DOM string
   * @returns {string[]} A list of text passages
   */
  chunk(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // parseFromString creates a full document (html > body).
    // We usually want to process the body's content.
    const rootAggNode = this._processNode(doc.body);

    if (rootAggNode.getPassages().length === 0) {
      rootAggNode.passageList.addPassageForNode(rootAggNode);
    }

    return rootAggNode.getPassages();
  }
}

/* Usage Example (Based on "Example 4" from your description)

   const html = `
       <div>
           <h1>Heading</h1>
           <p>Text before <a>link</a> and after.</p>
       </div>
   `;

   const chunker = new HtmlChunker({
       maxWordsPerAggregatePassage: 4,
       greedilyAggregateSiblingNodes: true
   });

   const passages = chunker.chunk(html);
   console.log(passages);
   // Expected: ["Heading", "Text before link", "and after."]
*/
