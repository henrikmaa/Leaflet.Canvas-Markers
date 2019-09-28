'use strict';

function layerFactory (L) {

    var CanvasIconLayer = L.Layer.extend({ // todo inherit from L.Renderer or L.Canvas

        options: L.Canvas.prototype.options,

        initialize: function (options) {
            L.Renderer.prototype.initialize.call(this, options);
            //_latlngMarkers contains Lat\Long coordinates of all markers in layer.
            this._latlngMarkers = new rbush();
            this._latlngMarkers.dirty = 0;
            this._latlngMarkers.total = 0;
            //_markers contains Points of markers currently displaying on map
            this._markers = new rbush();
        },

        onAdd: function () {
            L.Renderer.prototype.onAdd.call(this);
            L.DomUtil.toBack(this._container);
        },

        onRemove: function () {
            L.Renderer.prototype.onRemove.call(this);
        },

        _updatePaths: L.Util.falseFn, // stub for L.Renderer onAdd/onRemove

        getEvents: function () { // todo use L.Renderer.prototype.getEvents
            var events = {
                viewreset: this._reset,
                zoom: this._onZoom,
                moveend: this._update,
                click: this._onClick,
                mousemove: this._onMouseMove,
                mouseout: this._handleMouseOut
            };
            if (this._zoomAnimated) {
                events.zoomanim = this._onAnimZoom;
            }
            return events;
        },

        _onAnimZoom: function (ev) {
            L.Renderer.prototype._onAnimZoom.call(this, ev);
        },

        _onZoom: function () {
            L.Renderer.prototype._onZoom.call(this);
        },

        _initContainer: function () {
            L.Canvas.prototype._initContainer.call(this);
        },

        _reset: function () {
            this._update();
            this._updateTransform(this._center, this._zoom);
        },

        _updateTransform: function (center, zoom) {
            L.Renderer.prototype._updateTransform.call(this, center, zoom);
        },

        clearLayers: function () {
            this._latlngMarkers.clear();
            this._markers.clear();
            this._clear();
            return;
        },

        _clear: function () {
            L.Canvas.prototype._clear.call(this);
        },

        _redraw: function () {
            L.Canvas.prototype._redraw.call(this);
        },

        _destroyContainer: function () {
            L.Canvas.prototype._destroyContainer.call(this);
            this._markers.clear();
        },

        _update: function () {
            L.Canvas.prototype._update.call(this);
            this._draw();
        },

        _draw: function () {
            var bounds = this._redrawBounds;
            if (bounds) {
                var size = bounds.getSize();
                this._ctx.beginPath();
                this._ctx.rect(bounds.min.x, bounds.min.y, size.x, size.y);
                this._ctx.clip();
            }
            this._drawing = true;
            var tmp = [];
            // If we are 10% individual inserts\removals, reconstruct lookup for efficiency
            if (this._latlngMarkers.dirty / this._latlngMarkers.total >= .1) {
                this._latlngMarkers.all().forEach(function (el) {
                    tmp.push(el);
                });
                this._latlngMarkers.clear();
                this._latlngMarkers.load(tmp);
                this._latlngMarkers.dirty = 0;
                tmp = [];
            }
            var mapBounds = this._map.getBounds();

            // Only re-draw what we are showing on the map.
            this._latlngMarkers.search({
                minX: mapBounds.getWest(),
                minY: mapBounds.getSouth(),
                maxX: mapBounds.getEast(),
                maxY: mapBounds.getNorth()
            }).forEach(function (el) {
                // Readjust Point Map
                var marker = el.marker;
                if (!marker._map) { marker._map = this._map; } // todo ??implement proper handling in (on)add*/remove*

                var pointPos = this._map.latLngToContainerPoint(marker.getLatLng());
                this._drawMarker(marker, pointPos);

                var iconSize = marker.options.icon.options.iconSize;
                var adj_x = iconSize[0] / 2;
                var adj_y = iconSize[1] / 2;
                tmp.push({
                    minX: pointPos.x - adj_x,
                    minY: pointPos.y - adj_y,
                    maxX: pointPos.x + adj_x,
                    maxY: pointPos.y + adj_y,
                    marker: marker
                });
            }, this);
            this._drawing = false;
            // Clear rBush & Bulk Load for performance
            this._markers.clear();
            this._markers.load(tmp);
        },

        _drawMarker: function (marker, pointPos) {
            this._imageLookup = this._imageLookup || {};

            var iconUrl = marker.options.icon.options.iconUrl;
            var queued = this._imageLookup[iconUrl];
            if (!marker.canvas_img) {
                if (queued) {
                    marker.canvas_img = queued.img;
                    if (queued.loaded) {
                        this._drawImage(marker, pointPos);
                    } else {
                        queued.queue.push([marker, pointPos]);
                    }
                } else {
                    var img = new Image();
                    img.src = iconUrl;
                    marker.canvas_img = img;
                    queued = {
                        loaded: false,
                        img: img,
                        queue: [[marker, pointPos]]
                    };
                    this._imageLookup[iconUrl] = queued;
                    img.onload = function () {
                        queued.loaded = true;
                        queued.queue.forEach(function (el) {
                            this._drawImage(el[0], el[1]);
                        }, this);
                    }.bind(this);
                }
            } else if (queued.loaded) { // image may be not loaded / bad url
                this._drawImage(marker, pointPos);
            }
        },

        _drawImage: function (marker, pointPos) {
            var options = marker.options.icon.options;
            var pos = this._map.containerPointToLayerPoint(pointPos.subtract(options.iconAnchor));
            this._ctx.drawImage(
                marker.canvas_img,
                pos.x,
                pos.y,
                options.iconSize[0],
                options.iconSize[1]
            );
        },

        _searchPoints: function (point) {
            return this._markers && this._markers.search({
                minX: point.x, minY: point.y, maxX: point.x, maxY: point.y
            });
        },

        _onClick: function (e) {
            var point = e.containerPoint || this._map.mouseEventToContainerPoint(e), layer, clickedLayer; // !!L.Canvas uses mouseEventToLayerPoint(e)

            var layer_intersect = this._searchPoints(point);
            if (layer_intersect) {
                layer_intersect.forEach(function (el) {
                    layer = el.marker;
                    if (layer.options.interactive && !this._map._draggableMoved(layer)) {
                        clickedLayer = layer;
                    }
                }, this);
            }
            if (clickedLayer) {
                L.DomEvent.fakeStop(e);
                this._fireEvent([clickedLayer], e);
            }
        },

        _onMouseMove: function (e) {
            if (!this._map || this._map.dragging.moving() || this._map._animatingZoom) { return; }

            var point = e.containerPoint || this._map.mouseEventToContainerPoint(e); // !!L.Canvas uses mouseEventToLayerPoint(e)
            this._handleMouseHover(e, point);
        },

        _handleMouseHover: function (e, point) {
            var layer, candidateHoveredLayer;
            var layer_intersect = this._searchPoints(point);
            if (layer_intersect) {
                layer_intersect.forEach(function (el) {
                    layer = el.marker;
                    if (layer.options.interactive) {
                        candidateHoveredLayer = layer;
                    }
                }, this);
            }

            if (candidateHoveredLayer !== this._hoveredLayer) {
                this._handleMouseOut(e);

                if (candidateHoveredLayer) {
                    L.DomUtil.addClass(this._container, 'leaflet-interactive'); // change cursor
                    this._fireEvent([candidateHoveredLayer], e, 'mouseover');
                    this._hoveredLayer = candidateHoveredLayer;
                }
            }

            if (this._hoveredLayer) {
                this._fireEvent([this._hoveredLayer], e);
            }
        },

        _handleMouseOut: function (e) {
            L.Canvas.prototype._handleMouseOut.call(this,e);
        },

        _fireEvent: function (layers, e, type) {
            if (e.containerPoint) {
                layers[0].fire(type || e.type, e, true);
                return;
            }
            L.Canvas.prototype._fireEvent.call(this, layers, e, type);
        },

        // Multiple layers at a time for rBush performance
        addMarkers: function (markers, groupID) {
            groupID = groupID ? groupID.toString() : '0';
            this._groupIDs = this._groupIDs || {};
            this._groupIDs[groupID] = this._groupIDs[groupID] || 0;

            var tmpMark = [];
            var tmpLatLng = [];
            var mapBounds = this._map && this._map.getBounds();
            markers.forEach(function (marker) {
                var latlng = marker.getLatLng();
                var isDisplaying = mapBounds && mapBounds.contains(latlng);
                var s = this._addMarker(marker, latlng, isDisplaying);
                this._groupIDs[groupID]++;
                marker._canvasGroupID = groupID;
                if (isDisplaying) {
                    tmpMark.push(s[0]);
                }
                tmpLatLng.push(s[1]);
            }, this);
            this._markers.load(tmpMark);
            this._latlngMarkers.load(tmpLatLng);
        },

        // Adds single layer at a time. Less efficient for rBush
        addMarker: function (marker, groupID) {
            groupID = groupID ? groupID.toString() : '0';
            this._groupIDs = this._groupIDs || {};

            var latlng = marker.getLatLng();
            var isDisplaying = this._map && this._map.getBounds().contains(latlng);
            var dat = this._addMarker(marker, latlng, isDisplaying);
            this._groupIDs[groupID] = (this._groupIDs[groupID] || 0) + 1;
            marker._canvasGroupID = groupID;
            if (isDisplaying) {
                this._markers.insert(dat[0]);
            }
            this._latlngMarkers.insert(dat[1]);
        },

        addLayer: function (layer, groupID) {
            this.addMarker(layer,groupID);
        },

        addLayers: function (layers, groupID) {
            this.addMarkers(layers,groupID);
        },

        removeGroups: function (groupIDs) {
            groupIDs.forEach(function (groupID) {
                this._removeGroup(groupID);
            }, this);
            this._redraw();
        },

        removeGroup: function (groupID) {
            this._removeGroup(groupID);
            this._redraw();
        },

        _removeGroup: function (groupID) {
            groupID = groupID.toString();
            if (!this._groupIDs[groupID]) { return; }
            delete this._groupIDs[groupID];
            this._latlngMarkers.all().filter(function (el) {
                return el.marker._canvasGroupID === groupID;
            }).forEach(function (el) {
                this._latlngMarkers.remove(el);
                this._latlngMarkers.total--;
            }, this);
        },
        /*
        removeLayers: function (layers) {
            layers.forEach(function (el) {
                this.removeMarker(el, false);
            }, this);
            this._redraw();
        },
        */
        removeLayer: function (layer) {
            this.removeMarker(layer, true);
        },

        removeMarker: function (marker, redraw) {
            var latlng = marker.getLatLng();
            var isDisplaying = this._map && this._map.getBounds().contains(latlng);
            var val = {
                minX: latlng.lng,
                minY: latlng.lat,
                maxX: latlng.lng,
                maxY: latlng.lat,
                marker: marker
            };

            this._latlngMarkers.remove(val, function (a, b) {
                return a.marker === b.marker;
            });
            this._latlngMarkers.total--;

            if (isDisplaying && redraw) {
                this._redraw();
            }
            marker.removeEventParent(this);
        },

        _addMarker: function (marker, latlng, isDisplaying) {
            if (!(marker instanceof L.Marker)) {
                throw new Error("Layer isn't a marker");
            }
            marker._map = this._map; // Needed for pop-up & tooltip to work
            L.Util.stamp(marker);
            marker.addEventParent(this);

            this._latlngMarkers.dirty++;
            this._latlngMarkers.total++;
            var point;
            if (isDisplaying) {
                var pointPos = this._map.latLngToContainerPoint(latlng);
                this._drawMarker(marker, pointPos);

                var iconSize = marker.options.icon.options.iconSize;
                var adj_x = iconSize[0] / 2;
                var adj_y = iconSize[1] / 2;
                point = {
                    minX: pointPos.x - adj_x,
                    minY: pointPos.y - adj_y,
                    maxX: pointPos.x + adj_x,
                    maxY: pointPos.y + adj_y,
                    marker: marker
                };
            }

            return [
                point,
                {
                    minX: latlng.lng,
                    minY: latlng.lat,
                    maxX: latlng.lng,
                    maxY: latlng.lat,
                    marker: marker
                }
            ];
        }
    });

    L.canvasIconLayer = function (options) {
        return new CanvasIconLayer(options);
    };

    return CanvasIconLayer;
}

module.exports = layerFactory;
