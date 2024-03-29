const $loadModal = new bootstrap.Modal('#loadModal',{});

let fetchedURLs = {};
let filterRegexStr = '';
let filterRegex = new RegExp('.*', 'i');

let crawl = {
  id: new Date().getTime(),
  name: '',
  data: {
    startURL: '',
    queue: [],
    queueMaxLength: 1,
    alreadyFetched: {},
    results: {},
    responseHeaders: {}
  },
  settings: {
    stayonhostname: false,
    readability: false,
    charset: "utf-8",
    maxRetries: 0,
    delay: 0,
    maxConnections: 60,
    credentials: 'omit', // omit cookies …
    cache: 'no-store' // always fetch a fresh copy
  }
};


let $urlListTextarea = $('#urlListTextarea');

function mergeObjects(target,source) {
  Object.keys(source).forEach((key) => {
    target[key] = source[key];
  });
}

function init() {
  $('#spiderBtn').on('click', async function () {
    try {
      crawl.data.startURL = new URL($('#spiderURL').val().trim());
    } catch (error) {
      console.log(error.message);
    }
    if (!crawl.data.startURL.href) {
      return;
    }
    await initialize(crawl.data.startURL.href);
    $urlListTextarea.val(crawl.data.queue.join('\n'));
    setProgressbar();
  });

  $('#crawlBtn').on('click', function() {
    let tempQueue = $urlListTextarea.val().split('\n');
    if (tempQueue.length < 1) {
      console.log('tempQueue missing');
    }
    if (!crawl.data.startURL?.href) {
      try {
        crawl.data.startURL = new URL(tempQueue[0]);
      } catch (error) {
        console.log(error.message);
        return;
      }
    }
    crawl.data.queue = [];
    tempQueue.forEach((item, i) => {
      if (!item) {
        return;
      }
      try {
        let href = absoluteLink(item);
        if (href) {
          crawl.data.queue.push(href);
        }
      } catch (error) {
        console.log(error.message);
      }
    });

    performance.mark("crawl-started");
    processQueue();
  });

  $('#predefinedRegex').on('click', '.dropdown-item', function() {
    let re = $(this).data('regex');
    $('#regexFilter').val(re);
  });

  $('#regexFilterBtn').on('click', '.dropdown-item', function() {
    crawl.data.queue = $urlListTextarea.val().split('\n');
    filterRegexStr = $('#regexFilter').val().trim();
    filterRegex = new RegExp(filterRegexStr, 'i');
    if ($(this).data('type') == 'include') {
      crawl.data.queue = crawl.data.queue.filter(u => filterRegex.test(u));
    }
    if ($(this).data('type') == 'exclude') {
      crawl.data.queue = crawl.data.queue.filter(function (u) {
        return !(filterRegex.test(u));
      });
    }
    $urlListTextarea.val(crawl.data.queue.join('\n'));
    setProgressbar();
  });

  $('#save').on('click', saveCrawl);

  $('.crawlLoad').on('click', 'button', loadCrawl);

  $('#maxRetries').on('change', function() {
    crawl.settings.maxRetries = parseInt($(this).val());
    $('#maxRetries').val(crawl.settings.maxRetries);
    $('#maxRetriesValue').html(crawl.settings.maxRetries);
  });

  $('#maxConnections').on('change', function() {
    crawl.settings.maxConnections = parseInt($(this).val());
    $('#maxConnections').val(crawl.settings.maxConnections);
    $('#maxConnectionsValue').html(crawl.settings.maxConnections);
  });

  $('#delay').on('change', function() {
    crawl.settings.delay = parseInt($(this).val());
    $('#delay').val(crawl.settings.delay);
    $('#delayValue').html(crawl.settings.delay);
  });

  $('#credentials').on('change', function() {
    crawl.settings.credentials = $(this).val();
  });

  $('#cache').on('change', function() {
    crawl.settings.cache = $(this).val();
  });

  $('#charset').on('change', function() {
    crawl.settings.charset = $(this).val();
  });

  $('#readability').on('change', function() {
    crawl.settings.readability = $('#readability').is(':checked')
  });

  $('#stayonhostname').on('change', function() {
    crawl.settings.stayonhostname = $('#stayonhostname').is(':checked')
  });

  $('#loadCSVBtn').on('click', function () {
    $urlListTextarea.val(urlsTxt);
  });

  $('#loadSitemapBtn').on('click', function() {
    let link = $('#sitemapUrlInput').val().trim();
    if (!link) {
      return;
    }
    getSitemap(link);
  })
}
init();

function setProgressbar() {
  if (crawl.data.queueMaxLength < crawl.data.queue.length) {
    crawl.data.queueMaxLength = crawl.data.queue.length;
    performance.setResourceTimingBufferSize(crawl.data.queueMaxLength*(crawl.settings.maxRetries || 1));
  }
  let percentProgress = Math.round((crawl.data.queue.length/crawl.data.queueMaxLength)*100);
  $('#progress').css('width', `${percentProgress}%`);
  $('#progress').text(`${crawl.data.queue.length} urls`);
}

async function initialize(href) {
  if (!href) {
    console.log('href missing');
    return null;
  }
  crawl.data.queue = [];
  crawl.data.alreadyFetched = {};
  crawl.data.alreadyFetched[href] = 1;
  let u = new URL(href);
  let response = await fetch(u.href, {
    cache: crawl.settings.cache,
    credentials: crawl.settings.credentials
  })
  .catch((error) => {
    console.log(`error.message: ${u.href}`);
  });
  let buf = await response.arrayBuffer();
  let decoder = new TextDecoder(crawl.settings.charset);
  let html = decoder.decode(buf);

  //let html = await response.text();
  let parser = new DOMParser();

  let doc = parser.parseFromString(html, "text/html");
  crawl.data.queue = getLinks(doc);
  setProgressbar();
}

function absoluteLink(link) {
  if (!link) {
    return '';
  }
  let u;
  try {
    u = new URL(link);
  } catch (e) {
    //console.log(e.message);
    return '';
  }

  if (u.protocol == "chrome-extension:") {
    u.protocol = crawl.data.startURL.protocol;
    u.hostname = crawl.data.startURL.hostname;
  }

  if ((u.hostname != crawl.data.startURL.hostname) &&
    crawl.settings.stayonhostname)
  {
    return '';
  }

  u.hash = '';

  return u.href.trim();
}

function getLinks(doc) {
  [...doc.links].forEach((link, i) => {
    let ahref = link.attributes.getNamedItem("href").value
    if (ahref == "") {
      return null;
    }
    if (ahref.startsWith('#')) {
      return null;
    }

    let href = absoluteLink(link);
    if (!href) {
      return;
    }

    if (!crawl.data.alreadyFetched[href]) {
      crawl.data.alreadyFetched[href] = 0;
    } else {
      return null;
    }
  });

  return Object.keys(crawl.data.alreadyFetched);
}

function processPage(html, href) {
  if (!html) {
    return null;
  }
  let parser = new DOMParser();
  let doc = parser.parseFromString(html, "text/html");
  doc.URL = href;

  let metadata = {
    title: doc.title || '',
    description: doc.querySelectorAll('meta[name="description"]')?.[0]?.content || '',
    href: href,
    og: {
      image: doc.querySelectorAll('meta[property="og:image"]')?.[0]?.attributes?.content?.textContent || '',
      title: doc.querySelectorAll('meta[property="og:title"]')?.[0]?.content || '',
      site_name: doc.querySelectorAll('meta[property="og:site_name"]')?.[0]?.content || '',
      description: doc.querySelectorAll('meta[property="og:description"]')?.[0]?.content || ''
    },
    robots: doc.querySelectorAll('meta[name="robots"]')?.[0]?.content || '',
    canonical: doc.querySelectorAll('link[rel="canonical"]')?.[0]?.attributes?.href?.textContent,
    h1: doc.querySelectorAll('h1')?.[0]?.innerText || '',
    schema: getArticleSchema(doc)
  };

  if (crawl.settings.readability) {
    try {
      ['header', 'footer', 'nav'].forEach(selector => {
        doc.querySelectorAll(selector).forEach(element => { element.remove() })
      });
      let reader = new Readability(doc).parse();
      metadata['content'] = reader.textContent;

      let extract = parser.parseFromString(reader.content, "text/html");
      metadata['paragraphs'] = [];
      [...extract.getElementsByTagName('p')].forEach((p) => {
        if (p.innerText) {
          let txt = p.innerText.trim().replaceAll('\t',' ').replace(/\s+/g, ' ');
          if (txt) {
            metadata['paragraphs'].push(txt);
          }
        }
      });
    } catch (error) {
      console.log(`readability error`);
    }
  }

  return metadata;
}

function getArticleSchema(doc) {
  let schemaData = {
    publisher: '',
    dateModified: '',
    datePublished: '',
    authors: '',
    headline: '',
    alternateHeadline: ''
  };

  try {
    let schemaElements = [...doc.querySelectorAll('script[type="application/ld+json"]')];
    schemaElements.forEach((schemaElement, i) => {
      if (!schemaElement.textContent) {
        return;
      }
      let schemaObj = JSON.parse(schemaElement.textContent);
      let publisherObject = getValues(schemaObj,'publisher')[0];
      if (publisherObject) {
        if (publisherObject["@type"] == "Organization") {
          schemaData['publisher'] = publisherObject["name"];
        }
      }

      let headline = getValues(schemaObj,'headline')?.[0];
      if (headline) {
        schemaData['headline'] = headline;
      }

      let alternateHeadline = getValues(schemaObj,'alternateHeadline')?.[0];
      if (alternateHeadline) {
        schemaData['alternateHeadline'] = alternateHeadline;
      }

      let dateModified = getValues(schemaObj,'dateModified')?.[0];
      if (dateModified) {
        schemaData['dateModified'] = dateModified;
      }
      let datePublished = getValues(schemaObj,'datePublished')?.[0];
      if (datePublished) {
        schemaData['datePublished'] = datePublished;
      }

      let authors = getValues(schemaObj,'author')?.[0];
      if (authors?.length) {
        schemaData['authors'] = authors.map(author => author?.name).join(', ');
      } else {
        schemaData['authors'] = authors?.name;
      }
    });
  } catch (error) {
    console.log(`${error.message}: ${doc.URL}`);
  }

  return schemaData;
}

const sleep = time => new Promise(res => setTimeout(res, time, time));

const fetchURLQueue = [];
async function fetchURL(link) {
  if (crawl.data.alreadyFetched?.[link] > crawl.settings.maxRetries) {
    // already fetched
    return;
  }
  // increment to count tries
  crawl.data.alreadyFetched[link] = crawl.data.alreadyFetched[link] ? (crawl.data.alreadyFetched[link]+1) : 1;

  try {
    let u = new URL(link);
  } catch (e) {
    console.error(`${link} not a valid URL`);
    // no need to retry
    return;
  }

  let response = await fetch(link, {
    credentials: crawl.settings.credentials,
    cache: "no-cache"
  })
  .catch((error) => {
    console.error(`${error.message}: ${link}`)
  });

  if (!crawl.data.results[link]) {
    crawl.data.results[link] = {};
  }
  crawl.data.results[link]['fetch'] = {
    timestamp: (new Date().toISOString()),
    redirected: response?.redirected,
    status: response?.status,
    statusText: response?.statusText,
    ok: response?.ok
  };

  if (!response?.ok) {
    crawl.data.results[link]['href'] = link;
    // if response is borked and number of retries is not exceeded
    if (crawl.data.alreadyFetched?.[link] < crawl.settings.maxRetries) {
      crawl.data.queue.push(link);
    }
    return;
  }

  let buf = await response.arrayBuffer();
  let decoder = new TextDecoder(crawl.settings.charset);
  let html = decoder.decode(buf);
  //let html = await response.text();
  if (!html) {
    // needs better error handling
    // maybe retry?
    console.error(`reponse text error: ${link}`);
    return;
  }

  let metadata = processPage(html, link);

  if (!crawl.data.results[link]) {
    crawl.data.results[link] = metadata;
  } else {
    mergeObjects(crawl.data.results[link],metadata);
  }

  return sleep(crawl.settings.delay);
}

async function processQueue() {
  if (!crawl.data.queue) {
    return;
  }

  setProgressbar();

  function process() {
    let x = fetchURLQueue.pop();
    processQueue();
    if ((crawl.data.queue.length < 1) && (fetchURLQueue.length < 1)) {
      performance.mark("crawl-ended");
      //addPerformanceData();
      parseData();
    }
  }

  while (
    (fetchURLQueue.length <= crawl.settings.maxConnections) &&
    (crawl.data.queue.length > 0)
  ) {
    let link = crawl.data.queue.pop();
    if (!link) {
      continue;
    }
    fetchURLQueue.push(1);
    fetchURL(link)
    .then((data) => {
      process();
    })
    .catch((error) => {
      console.error(error.message);
      process();
    });
  }
}

function addPerformanceData() {
  Object.keys(crawl.data.results).forEach((link, i) => {
    try {
      let performanceData = performance.getEntriesByName(link);
      if (!performanceData || (performanceData.length < 1)) {
        return;
      }
      crawl.data.results[link]['performance'] = performanceData[performanceData.length-1].toJSON();
      delete crawl.data.results[link]['performance'].renderBlockingStatus;
      delete crawl.data.results[link]['performance'].workerStart;
      delete crawl.data.results[link]['performance'].entryType;
      delete crawl.data.results[link]['performance'].name;
    } catch (e) {
      console.error(`performance data not found for ${link}`);
    }
  });
}

function getValues(obj, key) {
  var objects = [];
  for (var i in obj) {
    if (!obj.hasOwnProperty(i)) continue;
    if (i == key) {
      objects.push(obj[i]);
    } else if (typeof obj[i] == 'object') {
      objects = objects.concat(getValues(obj[i], key));
    }
  }
  return objects;
}

function dict2flatarray(dict) {
  Object.entries(dict).forEach(([key, value]) => {
    if (typeof value == 'object') {
      Object.keys(value).forEach((item) => {
        if (typeof value[item] == 'object') {
          delete value[item];
        } else {
          dict[`${key}_${item}`] = value[item];
        }
      });
      delete dict[key];
    }
  });
  return dict;
}

function getCrawlList() {
  chrome.storage.local.get('crawlList', function(data) {
    $('.crawlLoad').empty();
    if (!data.crawlList) {
      return;
    }
    Object.entries(data?.crawlList).forEach(([key,value], i) => {
      $('.crawlLoad').append(`<button type="button" class="list-group-item list-group-item-action" data-crawlid="${key}">${(value.name || key)}</button>`);
    });
  });
}
getCrawlList();

function loadCrawl() {
  let id = $(this).data('crawlid');
  chrome.storage.local.get(id, function(items) {
    crawl = items[id];
    if (!crawl?.data) {
      return;
    }
    if (crawl.data?.queue.length > 0) {
      $urlListTextarea.val(crawl.data.queue.join('\n'));
    }
    if (crawl.data?.startURL) {
      $('#spiderURL').val(crawl.data.startURL);
      crawl.data.startURL = new URL(crawl.data.startURL);
    }
    if (crawl.data?.results) {
      parseData();
    }
    if (crawl.settings) {
      Object.keys(crawl.settings).forEach((key, i) => {
        $(`#${key}`).val(crawl.settings[key]);
        $(`#${key}Value`).html(crawl.settings[key]);
      });
    }

    $loadModal.hide();
  });
}
function buildCrawlName() {
  let dateStr = new Date(crawl.id).toLocaleString();
  let hostname = crawl?.data?.startURL?.hostname || '';
  if (!hostname) {
    try {
      hostname = new URL( $urlListTextarea.val().split('\n')[0] ).hostname;
    } catch (error) {
      console.log(`${error.message}`);
    }
  }
  crawl.name = `${dateStr} ${hostname}`;
}
function saveCrawl() {
  buildCrawlName();
  let data = {};
  let id = `crawl-${crawl.id}`;
  data[id] = crawl;
  data[id].data.startURL = crawl?.data?.startURL?.href;
  chrome.storage.local.set(data)
  .then(() => {
    console.log(`crawl "${id}" saved`);
  });

  chrome.storage.local.get('crawlList', function(items) {
    let data = {
      crawlList: items['crawlList'] || {}
    };
    data['crawlList'][id] = {
      id: crawl.id,
      name: crawl.name
    };
    chrome.storage.local.set(data)
    .then(() => {
      console.log(`saved "${id}" to list`);
      getCrawlList();
    });
  });
}

function parseData() {
  // flatten crawl results data
  let dataArray = JSON.parse(JSON.stringify(Object.values(crawl.data.results)));
  dataArray.forEach((dict, i) => {
    dict2flatarray(dict)
  });

  let columns = [
    {
      "field": "href",
      "title": "href",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "canonical",
      "title": "canonical",
      "sortable": true,
      "visible": true,
      "align": "left"
    },
    {
      "field": "title",
      "title": "title",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "description",
      "title": "description",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "keyword",
      "title": "keyword",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "robots",
      "title": "robots",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "h1",
      "title": "h1",
      "sortable": true,
      "visible": true,
      "align": "left"
    },
    {
      "field": "fetch_timestamp",
      "title": "fetch_timestamp",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "fetch_redirected",
      "title": "fetch_redirected",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "fetch_status",
      "title": "fetch_status",
      "sortable": true,
      "visible": false,
      "align": "right"
    },
    {
      "field": "fetch_statusText",
      "title": "fetch_statusText",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "fetch_ok",
      "title": "fetch_ok",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "og_image",
      "title": "og_image",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "og_title",
      "title": "og_title",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "og_site_name",
      "title": "og_site_name",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "og_description",
      "title": "og_description",
      "sortable": true,
      "visible": true,
      "align": "left"
    },
    {
      "field": "schema_publisher",
      "title": "schema_publisher",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "schema_dateModified",
      "title": "schema_dateModified",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "schema_datePublished",
      "title": "schema_datePublished",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "schema_authors",
      "title": "schema_authors",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "schema_headline",
      "title": "schema_headline",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "schema_alternateHeadline",
      "title": "schema_alternateHeadline",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "content",
      "title": "content",
      "sortable": true,
      "visible": false,
      "align": "left"
    }
  ];
  let performance = [
    {
      "field": "performance_startTime",
      "title": "performance_startTime",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_duration",
      "title": "performance_duration",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_initiatorType",
      "title": "performance_initiatorType",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_nextHopProtocol",
      "title": "performance_nextHopProtocol",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_redirectStart",
      "title": "performance_redirectStart",
      "sortable": true,
      "visible": false,
      "align": "right"
    },
    {
      "field": "performance_redirectEnd",
      "title": "performance_redirectEnd",
      "sortable": true,
      "visible": false,
      "align": "right"
    },
    {
      "field": "performance_fetchStart",
      "title": "performance_fetchStart",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_domainLookupStart",
      "title": "performance_domainLookupStart",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_domainLookupEnd",
      "title": "performance_domainLookupEnd",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_connectStart",
      "title": "performance_connectStart",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_secureConnectionStart",
      "title": "performance_secureConnectionStart",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_connectEnd",
      "title": "performance_connectEnd",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_requestStart",
      "title": "performance_requestStart",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_responseStart",
      "title": "performance_responseStart",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_responseEnd",
      "title": "performance_responseEnd",
      "sortable": true,
      "visible": false,
      "align": "left"
    },
    {
      "field": "performance_transferSize",
      "title": "performance_transferSize",
      "sortable": true,
      "visible": false,
      "align": "right"
    },
    {
      "field": "performance_encodedBodySize",
      "title": "performance_encodedBodySize",
      "sortable": true,
      "visible": false,
      "align": "right"
    },
    {
      "field": "performance_decodedBodySize",
      "title": "performance_decodedBodySize",
      "sortable": true,
      "visible": false,
      "align": "right"
    },
    {
      "field": "performance_responseStatus",
      "title": "performance_responseStatus",
      "sortable": true,
      "visible": false,
      "align": "right"
    }
  ];

  /*columns = [];
  Object.keys(dataArray[0]).forEach((key, i) => {
    columns.push({
      field: key,
      title: key,
      sortable: true,
      align: Number.isInteger(dataArray[0][key]) ? 'right' : 'left'
    });
  });
  */

  $('#jsonTable').bootstrapTable('destroy').bootstrapTable({
    exportTypes: ['csv'],
    exportDataType: 'all',
    pageList: [10000, "All"],
    columns: columns,
    data: dataArray
  });
}

chrome.webRequest.onHeadersReceived.addListener(
  responseHeaderHandler,
  {
    urls: ["<all_urls>"],
    types: ["xmlhttprequest"]
  },
  ["responseHeaders"]
)

function responseHeaderHandler(details) {
  crawl.data.responseHeaders[details.requestId] = {
    requestURL: details.url,
    responseHeaders: details.responseHeaders,
    timestamp: details.timeStamp,
    statusCode: details.statusCode,
    statusLine: details.statusLine,
    requestId: details.requestId
  };
}

function decompress(byteArray, format) {
  const cs = new DecompressionStream(format);
  const writer = cs.writable.getWriter();
  writer.write(byteArray);
  writer.close();
  return new Response(cs.readable).arrayBuffer().then(function (arrayBuffer) {
    return new TextDecoder().decode(arrayBuffer);
  });
}

// sitemap
async function getSitemap(link) {
  let response = await fetch(link, {
    credentials: crawl.settings.credentials,
    cache: "no-cache"
  })
  .catch((error) => {
    console.error(`${error.message}: ${link}`)
  });
  let content = '';

  if (link.indexOf('.gz') > -1) {
    const blob = await response.blob();
    const arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    content = await decompress(arrayBuffer, 'gzip');
  } else {
    content = await response.text();
  }

  let xmlDoc = parseXMLSitemap(content);
  let locations = xmlDoc.getElementsByTagName('loc');
  [...locations].forEach((loc, i) => {
    $urlListTextarea.append(`${loc.textContent}\n`);
  });

}

function parseXMLSitemap(sitemapContent) {
  var parser = new DOMParser();
  var xmlDoc = parser.parseFromString(sitemapContent, 'text/xml');
  return xmlDoc;
}

// file
const dropArea = document.getElementById('drop-area');
const fileInput = document.getElementById('fileInput');
dropArea.addEventListener('dragover', (event) => {
  event.stopPropagation();
  event.preventDefault();
  // Style the drag-and-drop as a "copy file" operation.
  event.dataTransfer.dropEffect = 'copy';
});

dropArea.addEventListener('drop', (event) => {
  event.stopPropagation();
  event.preventDefault();
  const fileList = event.dataTransfer.files;
  readActivities(fileList[0]);
});

fileInput.addEventListener('change', (event) => {
  const fileList = event.target.files;
  readActivities(fileList[0]);
});

function readActivities(file) {
  // Check if the file is an image.
  if (file.type && file.type != 'text/csv') {
    console.log('File is not a csv file.', file.type, file);
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', (event) => {
    parseActivitiesData(event.target.result);
  });
  reader.readAsText(file);
}

let urlsTxt = '';
function parseActivitiesData(textData) {
  let result = Papa.parse(textData, {
    header: true
  });
  urlsTxt = '';
  result?.data?.forEach((item, i) => {
    let url = item.URL || item.page;
    if (!url) {
      return;
    }
    urlsTxt += `${url}\n`;
  });
}
