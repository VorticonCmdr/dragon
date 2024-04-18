let config = {
  table: {
    columns: [],
    data: [],
  },
  gsc: {
    data: {},
  },
  topics: {
    data: [],
  },
  merge: [],
  entities: {},
  vectors: {
    data: {},
  },
  cluster: {
    data: {},
    keys: [],
    ids: {},
  },
  embedding: {
    endpoint: "http://localhost/ollama/api/embeddings",
    model: "mxbai-embed-large",
    vectors: [],
    data: {},
  },
};

const $table = $("#table");
$table.bootstrapTable({
  exportTypes: ["csv"],
  exportDataType: "all",
  pageSize: 10,
  buttons: tableButtons,
});

function tableButtons() {
  return {
    btnProcess: {
      text: "load data",
      icon: "bi-stars",
      event: function () {
        chrome.runtime.sendMessage({ query: "table" }, function (response) {
          config.topics.data = response.data;
          response.data.forEach((item) => {
            config.gsc.data[item["href"]] = {
              Clicks: item.clicks,
              Impressions: item.impressions,
            };
          });
          parseTopicsData();
        });
      },
      attributes: {
        title: "call for data",
      },
    },
  };
}

const dropArea = document.getElementById("drop-area");
const fileInput = document.getElementById("fileInput");
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

async function parseCSVData(textData) {
  let result = Papa.parse(textData.trim(), {
    header: true,
  });
  result.data.forEach((item) => {
    config.gsc.data[item["Page"]] = item;
  });
}

function invertedCosineSimilarity(vecA, vecB) {
  return 1 - cosineSimilarity(vecA, vecB);
}

function dotProduct(vecA, vecB) {
  let product = 0;
  let len = vecA.length;
  for (let i = 0; i < len; i++) {
    product += vecA[i] * vecB[i];
  }
  return product;
}

function norm(vec) {
  let sum = 0;
  let len = vec.length;
  for (let i = 0; i < len; i++) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(vecA, vecB) {
  return dotProduct(vecA, vecB) / (norm(vecA) * norm(vecB));
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

function calculateClusters() {
  performance.mark("startclusterTopics");
  Object.keys(config.entities).map((key) => {
    if (!config.vectors.data[key]) {
      return;
    }
    config.embedding.vectors.push({
      id: key,
      value: new Float64Array(Object.values(config.vectors.data[key])),
    });
  });

  config.cluster.data = hclust.clusterData({
    data: config.embedding.vectors,
    distance: invertedCosineSimilarity,
    key: "value",
    onProgress: function (progress) {
      document.title = `${Math.round(progress * 10000) / 100}% clustered`;
    },
  });

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

  config.table.data = config.table.data.map((data) => {
    data["cluster"] = config.cluster.ids[data.topics];
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
    pageSize: 10,
    columns: config.table.columns,
    data: config.table.data,
  });
}

function clusterTopics() {
  chrome.runtime.sendMessage({ query: "vectors" }, function (response) {
    config.vectors.data = response.data;
  });
}

function parseTopicsData() {
  console.log("parseTopicsData");
  config.topics.data
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

  config.table.columns = Object.keys(Object.values(config.entities)[0]).map(
    (field) => {
      return {
        field: field,
        title: field,
        sortable: true,
        visible: true,
        align: "left",
      };
    },
  );
  config.table.data = Object.values(config.entities);

  $table.bootstrapTable("destroy").bootstrapTable({
    exportTypes: ["csv"],
    exportDataType: "all",
    pageSize: 10,
    columns: config.table.columns,
    data: config.table.data,
  });
}

function init() {
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
}

init();
