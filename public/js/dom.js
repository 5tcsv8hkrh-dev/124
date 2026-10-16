/*
 * dom.js - a tiny helper for building page elements safely.
 *
 * h('p', { class: 'note' }, 'Some text')  ->  <p class="note">Some text</p>
 *
 * Text is always added with textContent / text nodes, never as HTML, so text that comes from
 * the server (including AI-written text) can never inject markup or scripts into the page.
 */
(function () {
  'use strict';

  function append(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) { append(parent, c); });
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }

  /**
   * @param {string} tag
   * @param {{class?: string, text?: string, attrs?: Object, on?: Object}} [props]
   * @param {...*} children  strings, elements, or arrays of them
   */
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    if (props.class) el.className = props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.attrs) {
      Object.keys(props.attrs).forEach(function (name) {
        if (props.attrs[name] !== null && props.attrs[name] !== undefined) el.setAttribute(name, props.attrs[name]);
      });
    }
    if (props.on) {
      Object.keys(props.on).forEach(function (evt) { el.addEventListener(evt, props.on[evt]); });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  window.CE = window.CE || {};
  window.CE.dom = { h: h, clear: clear };
})();
