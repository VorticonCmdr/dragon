let config = {
  table: {
    columns: [],
    data: [],
    topicData: [],
  },
  text: {
    id: "canonical",
    fields: ["h1", "og_description"],
  },
  embedding: {
    endpoint: "http://localhost/ollama/api/embeddings",
    model: "mxbai-embed-large",
    vectors: [],
    topicVectors: [],
    data: {},
  },
  cluster: {
    data: {},
    keys: [],
    ids: {},
  },
  topicCluster: {
    data: {},
    keys: [],
    ids: {},
  },
  vectors: {
    data: {},
  },
  entities: {},
  gsc: {
    data: {},
  },
  merge: [],
};

const $loadModal = new bootstrap.Modal("#loadModal", {});

const dropArea = document.getElementById("drop-area");
const fileInput = document.getElementById("fileInput");
const $table = $("#table");
$table.bootstrapTable({
  exportTypes: ["csv"],
  exportDataType: "all",
  pageSize: 10000,
});

function tableButtons() {
  return {
    btnProcess: {
      text: "generate topics",
      icon: "bi-stars",
      event: function () {
        if (config.table.data.length == 0) {
          return;
        }
        processData(config.table.data);
      },
      attributes: {
        title: "generates embeddings and topics",
      },
    },
  };
}

function loadCrawl() {
  let id = $(this).data("crawlid");
  chrome.storage.local.get(id, function (items) {
    crawl = items[id];
    if (!crawl?.data) {
      return;
    }

    config.table.data = Object.values(crawl.data.results).map((item) => {
      return {
        href: item.href,
        canonical: item.canonical,
        h1: item.h1,
        og_description: item?.og?.description || item.og_description,
        clicks: item.clicks,
        impressions: item.impressions,
      };
    });
    config.table.columns = Object.keys(config.table.data[0]).map((field) => {
      return {
        field: field,
        title: field,
        sortable: true,
        visible: true,
        align: "left",
      };
    });
    processTableData();

    $loadModal.hide();
  });
}

function readCSV(file) {
  // Check if the file is an image.
  if (file.type && file.type != "text/csv") {
    console.log("File is not a csv file.", file.type, file);
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", (event) => {
    parseCSVData(event.target.result);
  });
  reader.readAsText(file);
}

async function processTableData() {
  $table.bootstrapTable("destroy").bootstrapTable({
    exportTypes: ["csv"],
    exportDataType: "all",
    pageSize: 10000,
    columns: config.table.columns,
    data: config.table.data,
  });

  config.embedding.data = generateEmbeddingsText(config.table.data);
  await getEmbeddings(config.embedding.data);
  console.log("embeddings ready");
  config.cluster.data = clusterEmbeddings();
  console.log("clusters ready");

  let variances = [];
  for (let r = 0; r < config.cluster.data.distances.length; r++) {
    var v = calculateWithinClusterVariance(
      config.cluster.data.clustersGivenK,
      config.cluster.data.distances,
      r,
    );
    variances.push(v);
  }

  let p1 = findElbowPoint(variances);
  let p2 = findElbowPoint(variances.slice(0, p1));
  console.log(`elbow point: ${p2}`);

  config.cluster.data.clustersGivenK[p2].forEach((cluster, clusterNumber) => {
    cluster.forEach((point) => {
      let id = config.embedding.vectors[point]["id"];
      config.cluster.ids[id] = clusterNumber;
    });
  });

  config.table.data = config.table.data.map((data) => {
    let id = data[config.text.id];
    data["cluster"] = config.cluster.ids[id];
    return data;
  });
  config.table.columns.push({
    field: "cluster",
    title: "cluster",
    sortable: true,
    visible: true,
    align: "left",
  });
  $table.bootstrapTable("destroy").bootstrapTable({
    exportTypes: ["csv"],
    exportDataType: "all",
    pageSize: 10000,
    columns: config.table.columns,
    data: config.table.data,
  });
}

let urlsTxt = "";
async function parseCSVData(textData) {
  $table.bootstrapTable("removeAll");

  let result = Papa.parse(textData.trim(), {
    header: true,
  });
  config.table.columns = result.meta.fields.map((field) => {
    return {
      field: field,
      title: field,
      sortable: true,
      visible: true,
      align: "left",
    };
  });
  config.table.data = result.data;

  processTableData();
}

async function postData(url = "", data = {}) {
  // Default options are marked with *
  const response = await fetch(url, {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    headers: {
      "Content-Type": "application/json",
    },
    redirect: "follow", // manual, *follow, error
    body: JSON.stringify(data), // body data type must match "Content-Type" header
  });
  return response.json(); // parses JSON response into native JavaScript objects
}

async function getEmbedding(text) {
  if (config.vectors.data[text]) {
    return config.vectors.data[text];
  }
  let response = await postData(config.embedding.endpoint, {
    model: config.embedding.model,
    prompt: text,
  });
  config.vectors.data[text] = new Float64Array(response.embedding);
  return config.vectors.data[text];
}

function generateEmbeddingsText(data) {
  let result = {};
  data.forEach((item) => {
    let texts = [];
    config.text.fields.forEach((field) => {
      texts.push(item[field]);
    });
    result[item[config.text.id]] = texts.join(" ");
  });
  return result;
}

//
async function getEmbeddings(obj) {
  config.cluster.keys = Object.keys(obj);
  let len = config.cluster.keys.length;

  let result = {};
  while (len--) {
    var k = config.cluster.keys[len];
    var text = obj[k];
    var vector = await getEmbedding(text);
    config.embedding.vectors.push({
      id: k,
      value: vector,
    });
    result[k] = vector;
    document.title = `${len} embeddings left`;
  }
}

function dotProduct(vecA, vecB) {
  let product = 0;
  for (let i = 0; i < vecA.length; i++) {
    product += vecA[i] * vecB[i];
  }
  return product;
}

function norm(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(vecA, vecB) {
  return dotProduct(vecA, vecB) / (norm(vecA) * norm(vecB));
}

function invertedCosineSimilarity(vecA, vecB) {
  return 1 - cosineSimilarity(vecA, vecB);
}

function clusterEmbeddings() {
  let result = hclust.clusterData({
    data: config.embedding.vectors,
    distance: invertedCosineSimilarity,
    key: "value",
    onProgress: function (progress) {
      document.title = `${Math.round(progress * 10000) / 100}% clustered`;
    },
  });
  return result;
}

function calculateEuclideanDistance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

function findElbowPoint(variances) {
  const nPoints = variances.length;
  const firstPoint = [1, variances[0]];
  const lastPoint = [nPoints, variances[nPoints - 1]];

  let maxDistance = 0;
  let elbowPoint = 1;

  for (let i = 2; i <= nPoints; i++) {
    const currentPoint = [i, variances[i - 1]];
    const distance =
      Math.abs(
        (lastPoint[1] - firstPoint[1]) * currentPoint[0] -
          (lastPoint[0] - firstPoint[0]) * currentPoint[1] +
          lastPoint[0] * firstPoint[1] -
          lastPoint[1] * firstPoint[0],
      ) /
      calculateEuclideanDistance(
        firstPoint[0],
        firstPoint[1],
        lastPoint[0],
        lastPoint[1],
      );

    if (distance > maxDistance) {
      maxDistance = distance;
      elbowPoint = i;
    }
  }

  return elbowPoint;
}

function calculateDistance(point1, point2, distances) {
  // Assuming point1 and point2 are indices in the distance matrix,
  // retrieve the distance between these points.
  return distances[point1][point2];
}

function calculateClusterVariance(cluster, distances) {
  if (cluster.length <= 1) return 0;

  let sumOfDistances = 0;
  let count = 0;

  // Calculate the sum of distances between all pairs of points in the cluster
  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      sumOfDistances += calculateDistance(cluster[i], cluster[j], distances);
      count++;
    }
  }

  // The average distance in a cluster can be used as a measure of variance
  return sumOfDistances / count;
}

function calculateWithinClusterVariance(clustersGivenK, distances, K) {
  if (K <= 0 || K >= clustersGivenK.length) return null;

  let totalVariance = 0;
  const clustersAtK = clustersGivenK[K];

  // Calculate variance for each cluster at level K and sum them
  for (let cluster of clustersAtK) {
    totalVariance += calculateClusterVariance(cluster, distances);
  }

  return totalVariance;
}

async function processData(data) {
  let len = data.length;

  let cache = {};

  while (len--) {
    document.title = `${len} items left`;
    let item = data[len];

    if (cache[item.canonical]) {
      data[len]["topics"] = cache[item.canonical];
      continue;
    }

    let headlineVector = await getEmbedding(item.h1);

    let prompt = `Erstelle eine Liste der wichtigsten Entitäten zu diesem Text auf deutsch:\n${item.h1}\n${item.og_description}`;
    let response = await postData("http://localhost:11434/api/generate", {
      model: "llama2-topics",
      prompt: prompt,
      stream: false,
      options: {
        seed: 123,
        temperature: 0,
      },
    });
    let tokens = response.response
      .split("\n")
      .filter((line) => line.startsWith("* "))
      .map((d) =>
        d
          .slice(2)
          .replace(/\([^()]*\)/g, "")
          .trim(),
      )
      .filter((d) => d.length > 0);

    if (!tokens.length) {
      console.log("no tokens");
      continue;
    }

    //let dataset = [];
    let sims = {};
    let l = tokens.length;
    while (l--) {
      var token = tokens[l];
      var tokenVector = await getEmbedding(token);
      var similarity = cosineSimilarity(headlineVector, tokenVector);
      sims[token] = similarity;
    }
    let topics = Object.entries(sims)
      .sort((a, b) => b[1] - a[1])
      .map((d) => {
        return {
          topic: d[0],
          score: d[1],
        };
      });
    data[len]["topics"] = topics;
    cache[item.canonical] = topics;
  }
  document.title = `topics complete`;
  console.log(data);
  return data;
}

function countTopicOccurrences(data) {
  const count = {};

  // Iterate over each item in the array
  data.forEach((item) => {
    // Iterate over each topic in the 'topics' array
    item.topics
      .filter((item) => item.score >= 0.5)
      .forEach((topicItem) => {
        const topic = topicItem.topic;

        // If the topic is already in the count object, increment its count
        if (count[topic]) {
          count[topic]++;
        } else {
          // Otherwise, initialize it with a count of 1
          count[topic] = 1;
        }
      });
  });

  return count;
}

async function getCrawlList() {
  chrome.storage.local.get("crawlList", function (data) {
    $(".crawlLoad").empty();
    if (!data.crawlList) {
      return;
    }
    Object.entries(data?.crawlList).forEach(([key, value], i) => {
      $(".crawlLoad").append(
        `<button type="button" class="list-group-item list-group-item-action" data-crawlid="${key}">${value.name || key}</button>`,
      );
    });
    $(".crawlLoad").on("click", "button", loadCrawl);
  });
}

function parseTopicsData() {
  console.log("parseTopicsData");
  config.table.data
    .filter((item) => item.topics)
    .forEach((item) => {
      item["Clicks"] = config.gsc.data[item.href]["Clicks"];
      item["Impressions"] = config.gsc.data[item.href]["Impressions"];
      let topicsLength = item.topics.length;
      while (topicsLength--) {
        let clicks = parseInt(config.gsc.data[item.href]["Clicks"]) || 0;
        let impressions =
          parseInt(config.gsc.data[item.href]["Impressions"]) || 0;
        item.topics[topicsLength]["Clicks"] = clicks;
        item.topics[topicsLength]["Impressions"] = impressions;
        item.topics[topicsLength]["ClicksAvg"] = clicks / item.topics.length;
        item.topics[topicsLength]["ImpressionsAvg"] =
          impressions / item.topics.length;

        if (config.entities[item.topics[topicsLength]["topic"]]) {
          config.entities[item.topics[topicsLength]["topic"]]["Clicks"] +=
            clicks;
          config.entities[item.topics[topicsLength]["topic"]]["Impressions"] +=
            impressions;
          config.entities[item.topics[topicsLength]["topic"]]["ClicksAvg"] +=
            clicks / item.topics.length;
          config.entities[item.topics[topicsLength]["topic"]][
            "ImpressionsAvg"
          ] += impressions / item.topics.length;
          config.entities[item.topics[topicsLength]["topic"]]["count"] += 1;
        } else {
          config.entities[item.topics[topicsLength]["topic"]] = {
            topics: item.topics[topicsLength]["topic"],
            Clicks: clicks,
            Impressions: impressions,
            ClicksAvg: clicks / item.topics.length,
            ImpressionsAvg: impressions / item.topics.length,
            count: 1,
          };
        }
      }
      config.merge.push(item);
    });
}

function calculateClusters() {
  performance.mark("startclusterTopics");
  Object.keys(config.entities).map((key) => {
    if (!config.vectors.data[key]) {
      return;
    }
    config.embedding.topicVectors.push({
      id: key,
      value: new Float64Array(Object.values(config.vectors.data[key])),
    });
  });

  config.topicCluster.data = hclust.clusterData({
    data: config.embedding.topicVectors,
    distance: invertedCosineSimilarity,
    key: "value",
    onProgress: function (progress) {
      document.title = `${Math.round(progress * 10000) / 100}% clustered`;
    },
  });

  let variances = [];
  for (let r = 0; r < config.topicCluster.data.distances.length; r++) {
    var v = calculateWithinClusterVariance(
      config.topicCluster.data.clustersGivenK,
      config.topicCluster.data.distances,
      r,
    );
    variances.push(v);
  }

  let p1 = findElbowPoint(variances);
  let p2 = findElbowPoint(variances.slice(0, p1));
  console.log(`elbow point: ${p2}`);

  config.topicCluster.data.clustersGivenK[p2].forEach(
    (cluster, clusterNumber) => {
      cluster.forEach((point) => {
        let id = config.embedding.topicVectors[point]["id"];
        config.topicCluster.ids[id] = clusterNumber;
      });
    },
  );
  performance.mark("endclusterTopics");
  performance.measure(
    "clusterTopics",
    "startclusterTopics",
    "endclusterTopics",
  );
  let measures = performance.getEntriesByName("clusterTopics");
  console.log(measures[0].duration);
  // 48977.30000000447 float64Array
  // 49162.79999999702 untyped
  Object.values(config.entities).map((value) => {
    value["cluster"] = config.topicCluster.ids[value.topics];
    return value;
  });
}

function init() {
  getCrawlList();

  dropArea.addEventListener("dragover", (event) => {
    event.stopPropagation();
    event.preventDefault();
    // Style the drag-and-drop as a "copy file" operation.
    event.dataTransfer.dropEffect = "copy";
  });

  dropArea.addEventListener("drop", (event) => {
    event.stopPropagation();
    event.preventDefault();
    const fileList = event.dataTransfer.files;
    readCSV(fileList[0]);
  });

  fileInput.addEventListener("change", (event) => {
    const fileList = event.target.files;
    readCSV(fileList[0]);
  });

  chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
      //console.log(request);
      //console.log(sender);

      switch (request.query) {
        case "table":
          sendResponse({ data: config.table.data });
          break;
        case "vectors":
          sendResponse({ data: config.vectors.data });
          break;
        default:
          console.log(request);
      }
    },
  );
}
init();

/*
let ids = {}
config.embedding.vectors.forEach(item => {
  ids[item.id] = item.value;
});
vectorData = config.merge.map(item => {
  item['embedding'] = ids[item.canonical];
  return item;
});
*/
