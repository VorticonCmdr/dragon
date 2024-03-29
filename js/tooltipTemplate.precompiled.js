(function() {
  var template = Handlebars.template, templates = Handlebars.templates = Handlebars.templates || {};
templates['tooltipTemplate'] = template({"compiler":[8,">= 4.3.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, alias1=container.lambda, alias2=container.escapeExpression, lookupProperty = container.lookupProperty || function(parent, propertyName) {
        if (Object.prototype.hasOwnProperty.call(parent, propertyName)) {
          return parent[propertyName];
        }
        return undefined
    };

  return "<h5 class=\"card-title\">"
    + alias2(alias1((depth0 != null ? lookupProperty(depth0,"publisher") : depth0), depth0))
    + "</h5>\n<h6 class=\"card-subtitle mb-2 text-muted\"><a href=\""
    + ((stack1 = alias1((depth0 != null ? lookupProperty(depth0,"url") : depth0), depth0)) != null ? stack1 : "")
    + "\" target=\"_blank\">"
    + alias2(alias1((depth0 != null ? lookupProperty(depth0,"title") : depth0), depth0))
    + "</a></h6>\n<h6 class=\"card-subtitle mb-2 text-muted\">"
    + alias2(alias1((depth0 != null ? lookupProperty(depth0,"keyword") : depth0), depth0))
    + "</h6>\n";
},"useData":true});
})();