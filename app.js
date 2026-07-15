const state = {
  products: [],
  contactEmail: 'Fantasyflagstb@gmail.com',
  shopify: { enabled: false },
  activeProduct: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

async function loadData() {
  const response = await fetch('src/products.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Product data request failed (${response.status})`);
  const data = await response.json();
  state.products = Array.isArray(data.products) ? data.products : [];
  state.contactEmail = data.contactEmail || state.contactEmail;
  state.shopify = data.shopify || state.shopify;
}

function mediaFor(product) {
  if (product.imageMode === 'real' && product.image) {
    return `<img src="${esc(product.image)}" alt="${esc(product.name)}" loading="lazy" />`;
  }
  const cls = product.imageMode === 'empty' ? 'placeholder-art empty' : 'placeholder-art';
  return `<div class="${cls}" aria-label="Photography placeholder for ${esc(product.name)}">${esc(product.placeholderText || product.name)}</div>`;
}

function productCard(product) {
  const mediaClass = product.imageMode === 'real' ? 'has-real-image' : 'has-placeholder';
  return `<article class="shop-card ${mediaClass}" data-product="${esc(product.handle)}">
    <div class="shop-media">
      <span class="shop-card-label">${esc(product.label || product.category || 'Award')}</span>
      ${mediaFor(product)}
    </div>
    <div class="shop-body">
      <h3>${esc(product.name)}</h3>
      <p>${esc(product.description)}</p>
      <div class="shop-bottom">
        <strong class="price">${esc(product.priceText || product.price || '')}</strong>
        <button class="product-action" data-open-product="${esc(product.handle)}">${esc(product.cta || 'Customise')} →</button>
      </div>
    </div>
  </article>`;
}

function renderProducts() {
  const target = $('#product-list');
  if (!target) return;
  target.innerHTML = state.products.map(productCard).join('');
}

function findProduct(handle) {
  return state.products.find((product) => product.handle === handle) || null;
}

function checkoutAvailableFor(product) {
  const cfg = state.shopify || {};
  return Boolean(
    product?.purchaseMode === 'checkout' &&
    product.shopifyVariantId &&
    cfg.enabled &&
    cfg.shopDomain &&
    cfg.storefrontAccessToken
  );
}

function setFieldVisibility(product) {
  const fields = new Set(product.fields || []);
  const alwaysVisible = new Set(['customerName', 'customerEmail', 'customerPhone']);
  if (fields.has('winnerName')) fields.add('winnerStatus');
  $$('#customise-form [name]').forEach((input) => {
    const label = input.closest('label');
    if (!label) return;
    const shouldShow = alwaysVisible.has(input.name) || fields.size === 0 || fields.has(input.name);
    label.style.display = shouldShow ? 'grid' : 'none';
    input.disabled = !shouldShow;
    if (!shouldShow) input.value = '';
  });
}

function openProduct(handle) {
  const product = findProduct(handle);
  if (!product) return;
  state.activeProduct = product;
  $('#customise-form').reset();
  $('#modal-title').textContent = product.name;
  $('#modal-description').textContent = `${product.description} ${product.priceText ? `Price: ${product.priceText}.` : ''}`;
  $('#modal-status').textContent = '';
  setFieldVisibility(product);
  const checkoutButton = $('#continue-checkout');
  if (checkoutButton) checkoutButton.hidden = !checkoutAvailableFor(product);
  $('#customise-modal').showModal();
}

function collectCustomisation() {
  const form = $('#customise-form');
  const fd = new FormData(form);
  const data = {};
  for (const [key, value] of fd.entries()) {
    if (value instanceof File) continue;
    if (String(value).trim()) data[key] = String(value).trim();
  }
  const fileInput = form.elements.referenceFiles;
  const files = fileInput?.files ? Array.from(fileInput.files).map((file) => ({ name: file.name, size: file.size, type: file.type })) : [];
  data.referenceFiles = files;
  data.product = state.activeProduct?.name || '';
  data.productHandle = state.activeProduct?.handle || '';
  data.capturedAt = new Date().toISOString();
  return data;
}

function lineAttributes(customisation) {
  const attrs = [];
  const add = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    attrs.push({ key, value: Array.isArray(value) ? value.map((file) => file.name || file).join(', ') : String(value) });
  };
  add('Customer name', customisation.customerName);
  add('Customer email', customisation.customerEmail);
  add('Customer phone', customisation.customerPhone);
  add('League name', customisation.leagueName);
  add('Winner / recipient', customisation.winnerName || customisation.recipientName);
  add('Winner status', customisation.winnerStatus);
  add('Season', customisation.season);
  add('Engraving line 1', customisation.engravingLine1);
  add('Engraving line 2', customisation.engravingLine2);
  add('Award ideas', customisation.awardIdeas);
  add('Full player / team list', customisation.teamList);
  add('Final score / matchup', customisation.finalScore);
  add('Needed by', customisation.neededBy);
  add('Reference files', customisation.referenceFiles);
  add('Notes', customisation.notes);
  return attrs;
}

async function createShopifyCart(product, customisation) {
  const cfg = state.shopify || {};
  if (!checkoutAvailableFor(product)) {
    throw new Error('Secure checkout is unavailable for this item.');
  }

  const endpoint = `https://${cfg.shopDomain}/api/${cfg.apiVersion || '2026-01'}/graphql.json`;
  const query = `mutation cartCreate($input: CartInput!) { cartCreate(input: $input) { cart { checkoutUrl } userErrors { field message } } }`;
  const variables = {
    input: {
      lines: [{ merchandiseId: product.shopifyVariantId, quantity: 1, attributes: lineAttributes(customisation) }],
      note: `Fantasy Flags customisation for ${product.name}`,
      attributes: [
        { key: 'Source', value: 'Fantasy Flags website' },
        { key: 'Requires artwork check', value: customisation.referenceFiles?.length ? 'Yes - reference filenames supplied; request files manually' : 'No reference files named' }
      ]
    }
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': cfg.storefrontAccessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  const errors = payload?.data?.cartCreate?.userErrors || payload.errors;
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
  const checkoutUrl = payload?.data?.cartCreate?.cart?.checkoutUrl;
  if (!checkoutUrl) throw new Error('Shopify did not return a checkout URL.');
  return checkoutUrl;
}

function enquiryText(product, customisation) {
  return [
    `Hi Fantasy Flags,`,
    ``,
    `I’m interested in: ${product.name}`,
    ``,
    `My name: ${customisation.customerName || ''}`,
    `My email: ${customisation.customerEmail || ''}`,
    `My phone: ${customisation.customerPhone || ''}`,
    `League name: ${customisation.leagueName || ''}`,
    `Winner/recipient: ${customisation.winnerName || customisation.recipientName || ''}`,
    `Winner status: ${customisation.winnerStatus === 'later' ? 'I’ll send the winner after the grand final' : 'Winner is known'}`,
    `Season/year: ${customisation.season || ''}`,
    `Engraving line 1: ${customisation.engravingLine1 || ''}`,
    `Engraving line 2: ${customisation.engravingLine2 || ''}`,
    `Award ideas: ${customisation.awardIdeas || ''}`,
    `Full player / team list: ${customisation.teamList || ''}`,
    `Final score / matchup: ${customisation.finalScore || ''}`,
    `Needed by: ${customisation.neededBy || ''}`,
    `Reference files selected: ${(customisation.referenceFiles || []).map((f) => f.name).join(', ')}`,
    `Notes: ${customisation.notes || ''}`,
    ``,
    `Thanks.`
  ].join('\n');
}

function emailHref(product, customisation) {
  return `mailto:${state.contactEmail}?subject=${encodeURIComponent(`Fantasy Flags customisation — ${product.name}`)}&body=${encodeURIComponent(enquiryText(product, customisation))}`;
}

function formIsValid() {
  const form = $('#customise-form');
  if (form.checkValidity()) return true;
  $('#modal-status').textContent = 'Please complete the required name, email and league fields.';
  form.reportValidity();
  return false;
}

async function continueCheckout() {
  const product = state.activeProduct;
  if (!product || !formIsValid()) return;
  const customisation = collectCustomisation();
  const status = $('#modal-status');
  status.textContent = 'Preparing checkout details…';
  try {
    const checkoutUrl = await createShopifyCart(product, customisation);
    status.textContent = 'Opening Shopify checkout…';
    window.location.href = checkoutUrl;
  } catch (error) {
    status.textContent = `${error.message} For now, use “Email Details Instead” and we’ll follow up manually.`;
  }
}

function emailCustomisation() {
  const product = state.activeProduct;
  if (!product || !formIsValid()) return;
  const customisation = collectCustomisation();
  window.location.href = emailHref(product, customisation);
}

async function copyCustomisation() {
  const product = state.activeProduct;
  if (!product || !formIsValid()) return;
  const customisation = collectCustomisation();
  const status = $('#modal-status');
  try {
    await navigator.clipboard.writeText(enquiryText(product, customisation));
    status.textContent = `Enquiry details copied. Paste them into an email to ${state.contactEmail}.`;
  } catch {
    status.textContent = `Copy was blocked by your browser. Email us directly at ${state.contactEmail}.`;
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-product]');
    if (trigger) openProduct(trigger.dataset.openProduct);
  });
  $('#continue-checkout')?.addEventListener('click', continueCheckout);
  $('#copy-customisation')?.addEventListener('click', copyCustomisation);
  const form = $('#customise-form');
  form?.addEventListener('invalid', () => {
    $('#modal-status').textContent = 'Please complete the required name, email and league fields.';
  }, true);
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    emailCustomisation();
  });
  $('.modal-close')?.addEventListener('click', () => $('#customise-modal').close());
}

async function init() {
  bindEvents();
  await loadData();
  renderProducts();
  const checkoutButton = $('#continue-checkout');
  if (checkoutButton) checkoutButton.hidden = true;
}

init().catch((error) => {
  console.error('Fantasy Flags site failed to initialise', error);
  const target = $('#product-list');
  if (target) target.innerHTML = `<p class="load-error">Awards could not be loaded. Please <a href="mailto:${esc(state.contactEmail)}">email Fantasy Flags</a> and we'll help directly.</p>`;
});
