(function() {
  var template = Handlebars.template, templates = Handlebars.templates = Handlebars.templates || {};
templates['accordionTemplate'] = template({"1":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : (container.nullContext || {}), alias2=container.hooks.helperMissing, alias3="function", alias4=container.escapeExpression, alias5=container.lambda, lookupProperty = container.lookupProperty || function(parent, propertyName) {
        if (Object.prototype.hasOwnProperty.call(parent, propertyName)) {
          return parent[propertyName];
        }
        return undefined
    };

  return "<div class=\"accordion-item\">\n  <h2 class=\"accordion-header\" id=\"heading"
    + alias4(((helper = (helper = lookupProperty(helpers,"index") || (data && lookupProperty(data,"index"))) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"index","hash":{},"data":data,"loc":{"start":{"line":3,"column":42},"end":{"line":3,"column":52}}}) : helper)))
    + "\">\n    <button class=\"accordion-button collapsed\" type=\"button\" data-bs-toggle=\"collapse\" data-bs-target=\"#collapse"
    + alias4(((helper = (helper = lookupProperty(helpers,"index") || (data && lookupProperty(data,"index"))) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"index","hash":{},"data":data,"loc":{"start":{"line":4,"column":112},"end":{"line":4,"column":122}}}) : helper)))
    + "\">\n      "
    + alias4(alias5((depth0 != null ? lookupProperty(depth0,"Keyword") : depth0), depth0))
    + "\n    </button>\n  </h2>\n  <div id=\"collapse"
    + alias4(((helper = (helper = lookupProperty(helpers,"index") || (data && lookupProperty(data,"index"))) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"index","hash":{},"data":data,"loc":{"start":{"line":8,"column":19},"end":{"line":8,"column":29}}}) : helper)))
    + "\" class=\"accordion-collapse collapse\" data-bs-parent=\"#accordionRelated\">\n    <div class=\"accordion-body\">\n      <h5 class=\"card-title\"><a href=\""
    + ((stack1 = alias5((depth0 != null ? lookupProperty(depth0,"url") : depth0), depth0)) != null ? stack1 : "")
    + "\" target=\"_blank\">"
    + alias4(alias5((depth0 != null ? lookupProperty(depth0,"title") : depth0), depth0))
    + "</a></h5>\n      <small class=\"card-subtitle mb-2 text-muted\">"
    + alias4(alias5((depth0 != null ? lookupProperty(depth0,"description") : depth0), depth0))
    + "</small>\n    </div>\n  </div>\n</div>\n";
},"compiler":[8,">= 4.3.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, lookupProperty = container.lookupProperty || function(parent, propertyName) {
        if (Object.prototype.hasOwnProperty.call(parent, propertyName)) {
          return parent[propertyName];
        }
        return undefined
    };

  return ((stack1 = lookupProperty(helpers,"each").call(depth0 != null ? depth0 : (container.nullContext || {}),(depth0 != null ? lookupProperty(depth0,"hits") : depth0),{"name":"each","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data,"loc":{"start":{"line":1,"column":0},"end":{"line":15,"column":9}}})) != null ? stack1 : "");
},"useData":true});
})();
