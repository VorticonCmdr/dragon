const $loadModal = new bootstrap.Modal('#loadModal',{});
const $jsonTable = $('#jsonTable');
const $bsOffcanvas = new bootstrap.Offcanvas('#offcanvasRight')
const $offcanvasRight = document.getElementById('offcanvasRight');

const $menuOffcanvas = new bootstrap.Offcanvas('#offcanvasMenu');

const $cluster = $('#cluster');

const $jsonModal = new bootstrap.Modal('#jsonModal', {});
const $jsonModalToggle = document.getElementById('jsonModal');

let accordionTemplate = Handlebars.templates.accordionTemplate;
let tooltipTemplate = Handlebars.templates.tooltipTemplate;

let uri = new URL(document.location);
let debug = uri.searchParams.has('debug');
let keys = {
  openai: ''
};
let config = {
  urlRegex: {
  },
  opacity: {
    default: 0.7,
    selected: 1.0,
    unselected: 0.2
  },
  dbscan: {
    minPts: 3,
    eps: 0.3
  },
  umap: {
    nComponents: 2,
    minDist: 0.1,
    spread: 1.0,
    nNeighbors: 15
  }
};

let board = {
  coordinates: [],
  selectedCircles: [],
  sums: [],
  width: $('#board').width(),
  height: $('#board').height(),
  activeBrush: false,
  activeTooltip: false,
  margin: {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0
  }
};

let tableData = [];
let embeddingsData = [];

// csv file
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
  // Check if the file is a csv
  if (file.type && file.type != 'text/csv') {
    console.error('File is not a csv file.', file.type, file);
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', (event) => {
    parseActivitiesData(event.target.result);
  });
  reader.readAsText(file);
}

function parseActivitiesData(textData) {
  let result = Papa.parse(textData, {
    header: true,
    skipEmptyLines: true
  });
  $jsonTable.bootstrapTable('destroy').bootstrapTable({
    exportTypes: ['csv'],
    exportDataType: 'all',
    pageList: [1000, 10000, "All"],
    columns: result.meta.fields.map((field) => ({
      field: field,
      title: field,
      searchable: false,
      sortable: false
    })),
    data: result.data
  });

  tableData = result.data;
}

function reduceUniqueURLs() {
  $jsonTable.bootstrapTable('removeAll');
  if (debug) {
    console.log(tableData.length);
  }

  let dict = {};
  tableData.forEach((item, i) => {
    if ((item.title == '') && (item.description == '')) {
      return;
    }
    if (dict[item.url]) {
      return;
    }
    dict[item.url] = item;
  });
  tableData = Object.values(dict);
  $jsonTable.bootstrapTable('load', tableData);

  if (debug) {
    console.log(tableData.length);
  }
}

// json file
const dropAreaJson = document.getElementById('drop-area-json');
const jsonFileInput = document.getElementById('jsonFileInput');
dropArea.addEventListener('dragover', (event) => {
  event.stopPropagation();
  event.preventDefault();
  // Style the drag-and-drop as a "copy file" operation.
  event.dataTransfer.dropEffect = 'copy';
});

dropAreaJson.addEventListener('drop', (event) => {
  event.stopPropagation();
  event.preventDefault();
  const fileList = event.dataTransfer.files;
  readEmbeddingsJson(fileList[0]);
});

jsonFileInput.addEventListener('change', (event) => {
  const fileList = event.target.files;
  readEmbeddingsJson(fileList[0]);
});

function readEmbeddingsJson(file) {
  // Check if the file is a csv
  if (file.type && file.type != 'application/json') {
    console.error('File is not a json file.', file.type, file);
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', (event) => {
    embeddingsData = [...embeddingsData,...JSON.parse(event.target.result)];
    if (embeddingsData.length) {
      generateMap();
      $menuOffcanvas.hide();
      $jsonModal.toggle($jsonModalToggle);
    }
  });
  reader.readAsText(file);
}

function prepareData(data) {
  return data
    .map((entry) => entry['Keyword']);
}

function sliceArrayIntoChunks(arr, maxLength) {
    // Initialize an empty array to hold the chunks
    var chunks = [];

    // Loop through the array, slicing it into chunks of 'maxLength'
    for (var i = 0; i < arr.length; i += maxLength) {
        chunks.push(arr.slice(i, i + maxLength));
    }

    // Return the array of chunks
    return chunks;
}

async function getEmbeddings(inputData, parser) {

  let input = parser(inputData);

  let resp = await fetch('https://api.openai.com/v1/embeddings', {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${keys.openai}`
    },
    method: "POST",
    body: JSON.stringify({
      "input": input,
      "model": "text-embedding-3-small",
      "encoding_format": "float"
    })
  });
  let embeddingsResult = await resp.json();

  if (embeddingsResult.data.length != input.length) {
    console.error('number of embedding-results differs to number of inputs');
  }
  embeddingsResult.data.forEach((item, i) => {
    inputData[i]['embedding'] = item.embedding;
  });

  embeddingsData.push(...inputData);
}

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

async function csv2embeddings() {
  let chunks = sliceArrayIntoChunks(tableData, 100);
  while (chunks.length) {
    if (debug) {
      console.log(`${chunks.length} chunks left`);
    }
    let inputData = chunks.pop();
    await getEmbeddings(inputData, prepareData);
    await sleep(2000);
  }
  if (debug) {
    console.log('done');
  }
}

function generateMapVectors(data) {
  let vectors = data.map((item) => item.embedding);

  let coordinates = new UMAP(config.umap).fit(vectors);

  board.coordinates = [];

  coordinates.forEach((item, i) => {
    let xy = {
      x: item[0],
      y: item[1]
    }
    data[i]['coordinates'] = xy;
    board.coordinates.push(xy);
  });

  return data;
}

// let csv = Papa.unparse(tableData);
// downloadBlob(csv, 'brot-backen-cluster.csv', 'text/csv;charset=utf-8;');
function downloadBlob(content, filename, contentType) {
  // Create a blob
  var blob = new Blob([content], { type: contentType });
  var url = URL.createObjectURL(blob);

  // Create a link to download it
  var pom = document.createElement('a');
  pom.href = url;
  pom.setAttribute('download', filename);
  pom.click();
}

function downloadObjectAsJson(exportObj, exportName) {
    // Convert the object to a JSON string
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));

    // Create a temporary link element
    var downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", exportName + ".json");

    // Append the link to the body, click it, and then remove it
    document.body.appendChild(downloadAnchorNode); // required for Firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function regenerateMap() {
  board.svg.selectAll("*").remove();

  embeddingsData = generateMapVectors(embeddingsData);
  generateMap();
}

function cosineSimilarity(vec1, vec2) {
  const dotProduct = vec1.map((val, i) => val * vec2[i]).reduce((accum, curr) => accum + curr, 0);
  const vec1Size = calcVectorSize(vec1);
  const vec2Size = calcVectorSize(vec2);

  return dotProduct / (vec1Size * vec2Size);
}
function calcVectorSize(vec) {
  return Math.sqrt(vec.reduce((accum, curr) => accum + Math.pow(curr, 2), 0));
}

const SPACE_OR_PUNCTUATION = /[\n\r -#%-*,-/:;?@[-\]_{}\u00A0\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u1680\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2000-\u200A\u2010-\u2029\u202F-\u2043\u2045-\u2051\u2053-\u205F\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u3000-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/u;
function calculateTermFrequencies(docs) {
  let frequencies = {};
  docs.forEach(doc => {
      doc.split(SPACE_OR_PUNCTUATION).forEach(word => {
          word = word.toLowerCase();
          frequencies[word] = (frequencies[word] || 0) + 1;
      });
  });
  return frequencies;
}
function calculateSignificance(subsetDocs, allDocs) {
  let subsetFreq = calculateTermFrequencies(subsetDocs);
  let allFreq = calculateTermFrequencies(allDocs);

  let significanceScores = {};
  for (let word in subsetFreq) {
      let subsetScore = subsetFreq[word] / subsetDocs.length;
      let allScore = (allFreq[word] || 0) / allDocs.length;
      significanceScores[word] = subsetScore / allScore;
  }

  return Object.entries(significanceScores)
               .sort((a, b) => b[1] - a[1])
               .map(entry => ({word: entry[0], score: entry[1]}));
}

function handleZoom(e) {
  d3.selectAll('.datalayer').attr('transform', e.transform);
}

function resetZoom () {
  d3.selectAll('.datalayer')
    .transition()
    .call(board['zoom'].scaleTo, 1);

  d3.selectAll('.datalayer')
    .transition()
    .call(board['zoom'].translateTo, 0.5 * board.width, 0.5 * board.height);
}

function brushed({selection}) {
  if (selection === null) {
    board['circles'].attr("stroke", null);
  } else {
    let tx = d3.zoomTransform(board.svg.select('#circles')['_groups'][0][0]);
    let [[x0, y0], [x1, y1]] = selection;
    board.selectedCircles = [];
    board['circles'].each(function(d,i) {
      let elem = d3.select(this);
      let cx = tx.x+elem.attr('cx')*tx.k;
      let cy = tx.y+elem.attr('cy')*tx.k;
      if (x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1) {
        elem.attr('stroke','red');
        board.selectedCircles.push(elem.data()[0]);
      } else {
        elem.attr('stroke', null);
      }
    });
    if (board.selectedCircles.length > 0) {
      let html = accordionTemplate({
        hits: board.selectedCircles
      });
      $('#accordionRelated').html(html);
      $bsOffcanvas.show();
    }
  }
}

function colorCircles() {
  board.circles
    .filter(function(d) {
      return d && (d.url.indexOf("dm.de") > -1);
    })
    .attr("fill", "#7400E2")
    .attr("opacity", config.opacity.default)
    .attr("r",2);
}

function mouseenter(event, d) {
  if (board.activeBrush) {
    return;
  }
  if (!board.activeTooltip) {
    return;
  }
  let data = {
    title: d.Keyword,
    //publisher: d.publisher,
    canonical: d.Keyword,
    keyword: d.Keyword
  };
  $('#tooltip-body').html(tooltipTemplate(data));
  $('#tooltip').show();
}

function centerNode(id){
  let cx = d3.select(id).attr('cx');;
  let cy = d3.select(id).attr('cy');
  d3.selectAll('.datalayer').transition()
  .duration(300)
  .attr("transform", `translate(${0.5*board.width-cx},${0.5*board.height-cy})scale(2)`)
  .on("end", function(){ board.zoomer.call(board.zoom.transform, d3.zoomIdentity.translate((0.5*board.width-(cx*2)),(0.5*board.height-(cy*2))).scale(2))});
}

function showCluster(d) {
  if (debug) {
    console.log(d);
  }

  $('#offcanvasRightLabel').text('');
  $('#offcanvasRightLabel').text(d.cluster);
  let cluster = d.cluster;
  let cid = `#c${d.coordinates.x}${d.coordinates.y}`.replaceAll('.','').replaceAll('-','s');
  centerNode(cid);

  $('#accordionRelated').empty();
  board['circles']
    .attr("data-related", "false")
    .attr("opacity", config.opacity.unselected)
    .attr('stroke', null);

  board['circles']
    .filter(function(d){
      let isCluster = d.cluster == cluster;
      return isCluster;
    })
    .attr("data-related", "true")
    .attr("opacity", config.opacity.selected)
    .attr('stroke','red');

  let hits = board['circles']
    .filter(function(d){
      return d.cluster == cluster
    })
    .data();
  let html = accordionTemplate({
    hits: hits
  });
  $('#accordionRelated').html(html);
  $bsOffcanvas.show();
}

function click(event, d) {
  if (event.altKey) {
    pointClick(d.url);
  } else {
    showCluster(d);
  }
}

// A function to check whether two bounding boxes do not overlap
const getOverlapFromTwoExtents = (l, r) => {
  var overlapPadding = 0
  l.left = l.x - overlapPadding
    l.right = l.x + l.width + overlapPadding
    l.top = l.y - overlapPadding
    l.bottom = l.y + l.height + overlapPadding
  r.left = r.x - overlapPadding
    r.right = r.x + r.width + overlapPadding
    r.top = r.y - overlapPadding
    r.bottom = r.y + r.height + overlapPadding
  var a = l
  var b = r

  if (a.left >= b.right || a.top >= b.bottom ||
      a.right <= b.left || a.bottom <= b.top ){
    return true
  } else {
    return false
  }
}

function generateMap() {
  $('#board').toggleClass('visible');
  $('#table').toggleClass('invisible');
  if (!board.coordinates.length) {
    board.coordinates = embeddingsData.map((item) => item.coordinates);
  }

  board['svg'] = d3
      .select("#map")
      .attr('height', board.height)
      .attr('width', board.width);

  board['zoom'] = d3.zoom()
    .on('zoom', (event) => {
      svg.attr('transform', event.transform);
    });

  board['zoom'] = d3.zoom()
    //.filter(event => !activeBrush)
    .filter(event => {
        return !board.activeBrush;
      })
    .on('zoom', handleZoom);

  // initZoom
  board['zoomer'] = d3.select('svg').call(board['zoom']);

  board['xScale'] = d3.scaleLinear()
    .range([board.margin.left, board.width - board.margin.right])
    .domain(d3.extent( board.coordinates.map(d => d.x) ));

  board['yScale'] = d3.scaleLinear()
    .range([board.height - board.margin.bottom, board.margin.top])
    .domain(d3.extent( board.coordinates.map(d => d.y) ));

  board['labels'] = board.svg
    .append("g")
    .attr("id", "labels")
    .attr("class", "datalayer")
    .attr("font-size", 10)
    .selectAll("text")
    .data(embeddingsData)
    .join("text")
      .attr('id', d => `t${d.coordinates.x}${d.coordinates.y}`.replaceAll('.','').replaceAll('-','s'))
      .attr("dy", "0.35em")
      .attr("x", d => board.xScale(d.coordinates.x) + 3)
      .attr("y", d => board.yScale(d.coordinates.y))
      .attr("data-keyword", d => d.Keyword)
      .attr("opacity",0)
      .text(d => d.Keyword);

  board['brush'] = d3.brush()
    .filter(event => {
        return board.activeBrush || (event.target.__data__.type !== "overlay");
      })
    .on("end", brushed);

  board.svg.append("g")
    .attr("class", "brush")
    .call(board.brush)
    .call(g => g.select(".overlay").style("cursor", "default"));


  const distance = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

  let dbscanner = jDBSCAN()
  	.eps(config.dbscan.eps)
  	.minPts(config.dbscan.minPts)
  	.distance('EUCLIDEAN')
  	.data(board.coordinates);



  board['point_assignment_result'] = dbscanner();
  board['cluster_centers'] = dbscanner.getClusters();

  board['point_assignment_result'].forEach((cluster, i) => {
    embeddingsData[i]['cluster'] = cluster;
  });


  board['setCentroids'] = [];
  board['cluster_centers'].forEach((cc,i) => {
    let minDist = 0xffff;
    cc.parts.forEach((ccp) => {
      let h = embeddingsData[ccp];
      let dist = distance(cc.x,cc.y,h.coordinates.x,h.coordinates.y);
      if (dist < minDist) {
        minDist = dist;
        board.setCentroids[i] = h;
      }
    });
  });

  // append circles last to be on top
  board['circles'] = board.svg
    .append("g")
    .attr("id", "circles")
    .attr("class", "datalayer")
    .selectAll("circle")
    .data(embeddingsData)
    .join("circle")
      .attr('id', d => `c${d.coordinates.x}${d.coordinates.y}`.replaceAll('.','').replaceAll('-','s'))
      .attr('cx', d => board.xScale(d.coordinates.x))
      .attr('cy', d => board.yScale(d.coordinates.y))
      .attr("r", 2)
      .attr('fill', '#a9a9a9')
      .attr("opacity", config.opacity.default)
      .attr("data-url", d => d.url)
      .attr("data-keyword", d => d.Keyword)
      .attr("data-keyword", d => d.cluster)
      .on("mouseenter", mouseenter )
      .on("click", click)

  board['circles'].attr('opacity',config.opacity.unselected);
  let bboxes = [];
  $cluster.empty();
  $cluster.append(`<option value="">auto generated cluster</option>`);

  board.setCentroids.forEach((item, i) => {
    let cid = `#c${item.coordinates.x}${item.coordinates.y}`.replaceAll('.','').replaceAll('-','s');
    let tid = `#t${item.coordinates.x}${item.coordinates.y}`.replaceAll('.','').replaceAll('-','s');

    let thisBBox = d3.select(tid)._groups[0][0].getBBox();
    let overlap = true;
    bboxes.forEach((otherBBox) => {
      overlap &= getOverlapFromTwoExtents(thisBBox, otherBBox);
    });
    if (overlap) {
      bboxes.push(thisBBox);
      d3.select(tid)
        .attr("opacity", 1);
      d3.select(tid)
        .data(d3.select(cid).data()[0]);
      d3.select(cid)
        .attr('fill', "#000000")
        .attr("opacity", 1);
    }

    $cluster.append(`<option value="${item.cluster-1}">${item.Keyword}</option>`);
  });

}

function generateColors(numColors) {
    const colors = [];
    const hueStep = 360 / numColors; // Divide the color wheel into equal parts

    for (let i = 0; i < numColors; i++) {
        const hue = i * hueStep;
        colors.push(`hsl(${hue}, 100%, 50%)`); // Saturation: 100%, Lightness: 50%
    }

    return colors;
}
function colorClusters() {
  let colors = generateColors(board.cluster_centers.length);
  colors.forEach((color, i) => {
    board.circles
      .filter(function(d) {
        return d && (d.cluster == i);
      })
      .attr("fill", color)
      .attr("opacity", config.opacity.default)
      .attr("r",2);
  });
}

function compress(string, format) {
  const byteArray = new TextEncoder().encode(string);
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  writer.write(byteArray);
  writer.close();
  return new Response(cs.readable).arrayBuffer();
}
function _arrayBufferToBase64( buffer ) {
  let binary = '';
  let bytes = new Uint8Array( buffer );
  let len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode( bytes[ i ] );
  }
  return window.btoa(binary)
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, ''); // Remove ending '='
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
function _base64ToArrayBuffer( str ) {
  str += Array(5 - str.length % 4).join('=');
  str = str
    .replace(/\-/g, '+') // Convert '-' to '+'
    .replace(/\_/g, '/') // Convert '_' to '/'
    .replace('====','');

  let binaryString = window.atob(str);
  let bytes = new Uint8Array(binaryString.length);
  for (var i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
async function loadConfigFromHash() {
  if (!uri.hash) {
    return;
  }
  try {
    let str = uri.hash.slice(1);
    let buffer = _base64ToArrayBuffer(str);
    let output = await decompress(buffer, 'gzip');
    config = JSON.parse(output);
  } catch (error) {
    console.error(error);
  }
}
async function saveConfigToHash() {
  try {
    let buffer = await compress(JSON.stringify(config), 'gzip');
    let hash = _arrayBufferToBase64(buffer);
    uri.hash = hash;
    history.pushState(null, null, uri.href);
  } catch (error) {
    console.error(error);
  }
}

function saveKeys() {
  chrome.storage.local.set({
    keys: keys
  }).then(() => {
    if (debug) {
      console.log("keys is set");
    }
  });
}

function saveConfig() {
  chrome.storage.local.set({
    config: config
  }).then(() => {
    if (debug) {
      console.log("config is set");
    }
  });
}

function setupConfig() {
  let $epsValue = $('#epsValue');
  $('#eps').on('change', function() {
    config.dbscan.eps = parseFloat($(this).val());
    $epsValue.text(config.dbscan.eps);
  });

  let $minPtsValue = $('#minPtsValue');
  $('#minPts').on('change', function() {
    config.dbscan.minPts = parseInt($(this).val());
    $minPtsValue.text(config.dbscan.minPts);
  });

  let $minDistValue = $('#minDistValue');
  $('#minDist').on('change', function() {
    config.umap.minDist = parseFloat($(this).val());
    $minDistValue.text(config.umap.minDist);
  });

  let $spreadValue = $('#spreadValue');
  $('#spread').on('change', function() {
    config.umap.spread = parseFloat($(this).val());
    $spreadValue.text(config.umap.spread);
  });

  let $nNeighborsValue = $('#nNeighborsValue');
  $('#nNeighbors').on('change', function() {
    config.umap.nNeighbors = parseInt($(this).val());
    $nNeighborsValue.text(config.umap.nNeighbors);
  });

  $('#apikey').val(keys.openai);
}

function colorURL(urlRegex, color) {
  board.circles
    .filter(function(d) {
      return d && (d.url.match(urlRegex));
    })
    .attr("fill", color)
    .attr("opacity", config.opacity.default)
    .attr("r",2);
}

function colorByUrlRegex() {
  Object.entries(config.urlRegex).forEach(([urlRegex, color], i) => {
    colorURL(urlRegex, color);
  });
}

function init() {
  setupConfig();

  $offcanvasRight.addEventListener('hide.bs.offcanvas', event => {
    if (!board['circles']) {
      return;
    }
    board['circles']
      .attr("data-related", "false")
      .attr("opacity", config.opacity.default)
      .attr('stroke', null);
    //processCanonicalInfos();
  });

  $('#canonicalBtn').on('click', function() {
    addCanonical();
  });
  $('#colorClusters').on('click', function() {
    colorClusters();
  });

  $('#urlRegexBtn').on('click', function () {
    let urlRegex = $('#urlRegex').val().trim();
    if (!urlRegex) {
      console.error('missing urlRegex');
      return;
    }
    let color = $('#urlRegexColor').val();
    config.urlRegex[urlRegex] = color;
    colorByUrlRegex();
  });

  $('#resetZoom').on('click', function() {
    resetZoom();
  });

  $('#regenerateMap').on('click', function() {
    regenerateMap();
  });

  $cluster.on('change', function(e) {
    let cluster = $('#cluster option:selected').val();
    if (cluster == '') {
      return;
    }

    showCluster(board.setCentroids[cluster]);
    $menuOffcanvas.hide();
  });
}

chrome.storage.local.get(["keys"], function(data) {
  keys = data.keys;
  if (debug) {
    console.log(keys);
  }
});

chrome.storage.local.get(["config"], function(data) {
  config = data.config;
  if (debug) {
    console.log(config);
  }
  init();
});
