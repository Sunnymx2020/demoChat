import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://bjdecznpfkwdawywzlpb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqZGVjem5wZmt3ZGF3eXd6bHBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE0MTc0OTMsImV4cCI6MjA3Njk5MzQ5M30.L-CU5LsOGaX6safSj1h8-507UOp0Hl2tT5lFRVNGi0M';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const emailInput = document.getElementById('email');
const btnSignup = document.getElementById('btn-signup');
const meBox = document.getElementById('me');
const meUid = document.getElementById('me-uid');
const shareIdInput = document.getElementById('share-id');
const peerIdInput = document.getElementById('peer-id-input');
const btnSendRequest = document.getElementById('btn-send-request');
const btnOpenScanner = document.getElementById('btn-open-scanner');
const requestsList = document.getElementById('requests-list');
const contactsList = document.getElementById('contacts-list');
const chatWith = document.getElementById('chat-with');
const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const textInput = document.getElementById('text');
const fileInput = document.getElementById('file');
const scannerEl = document.getElementById('scanner');
const qrVideo = document.getElementById('qr-video');
const closeScanner = document.getElementById('close-scanner');

let currentUser = null;
let currentPeer = null;
let qrScanner = null;
let activeRoomChannel = null;

btnSignup.onclick = async () => {
  const email = emailInput.value.trim();
  if (!email) return alert('enter email');
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) return alert('auth error: ' + error.message);
  alert('Magic link sent. Verify and refresh.');
};

window.addEventListener('load', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    onLoggedIn();
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      currentUser = session.user;
      onLoggedIn();
    }
  });
});

async function onLoggedIn() {
  emailInput.classList.add('hidden');
  btnSignup.classList.add('hidden');
  meBox.classList.remove('hidden');
  meUid.textContent = `You: ${currentUser.id}`;
  shareIdInput.value = currentUser.id;
  subscribeToRequests();
  loadContacts();
}

async function subscribeToRequests() {
  supabase.channel('requests-' + currentUser.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_requests', filter: `to_uid=eq.${currentUser.id}` }, payload => {
      renderRequest(payload.new);
    })
    .subscribe();
  const { data } = await supabase.from('chat_requests').select('*').eq('to_uid', currentUser.id);
  if (data) data.forEach(renderRequest);
}

function renderRequest(r) {
  const wrapper = document.createElement('div');
  wrapper.className = 'request';
  wrapper.innerHTML = `<div>${r.from_email || r.from_uid} wants to chat</div>`;
  const accept = document.createElement('button');
  accept.textContent = 'Accept';
  accept.onclick = () => acceptRequest(r);
  wrapper.appendChild(accept);
  requestsList.prepend(wrapper);
}

async function acceptRequest(r) {
  await supabase.from('contacts').insert([{ user_uid: currentUser.id, contact_uid: r.from_uid }, { user_uid: r.from_uid, contact_uid: currentUser.id }]);
  await supabase.from('chat_requests').delete().eq('id', r.id);
  loadContacts();
  alert('Contact added.');
}

async function loadContacts() {
  contactsList.innerHTML = '';
  const { data } = await supabase.from('contacts').select('*').eq('user_uid', currentUser.id);
  if (!data) return;
  for (const c of data) {
    const item = document.createElement('div');
    item.className = 'contact';
    item.textContent = c.contact_uid;
    item.onclick = () => openChatWith(c.contact_uid);
    contactsList.appendChild(item);
  }
}

async function openChatWith(peerUid) {
  currentPeer = peerUid;
  chatWith.textContent = `Chat with ${peerUid}`;
  messagesEl.innerHTML = '';
  composer.classList.remove('hidden');
  const room = roomIdFor(currentUser.id, currentPeer);
  const { data } = await supabase.from('messages').select('*').eq('room', room).order('created_at', { ascending: true });
  if (data) data.forEach(renderMessage);
  if (activeRoomChannel) await supabase.removeChannel(activeRoomChannel);
  activeRoomChannel = supabase.channel('messages-' + room);
  activeRoomChannel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room=eq.${room}` }, payload => {
    renderMessage(payload.new);
  });
  activeRoomChannel.subscribe();
}

function roomIdFor(a, b) {
  return [a, b].sort().join('--');
}

async function renderMessage(m) {
  const div = document.createElement('div');
  div.className = 'msg ' + (m.from_uid === currentUser.id ? 'me' : 'them');
  let html = `<div style="font-size:12px;color:var(--muted)">${m.from_uid}</div>`;
  if (m.text) html += `<div>${escapeHtml(m.text)}</div>`;
  if (m.image_path) {
    const { data } = supabase.storage.from('chat-images').getPublicUrl(m.image_path);
    html += `<div><img src="${data.publicUrl}" style="max-width:320px;border-radius:8px"></div>`;
  }
  div.innerHTML = html;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(s) {
  return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
}

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentPeer) return alert('select contact');
  const txt = textInput.value.trim();
  const file = fileInput.files[0];
  let image_path = null;
  if (file) {
    const fname = `${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage.from('chat-images').upload(fname, file);
    if (error) return alert('upload failed');
    image_path = data.path;
  }
  await supabase.from('messages').insert([{ room: roomIdFor(currentUser.id, currentPeer), from_uid: currentUser.id, to_uid: currentPeer, text: txt || null, image_path, created_at: new Date() }]);
  textInput.value = '';
  fileInput.value = '';
});

btnSendRequest.onclick = async () => {
  const target = peerIdInput.value.trim();
  if (!target) return alert('paste peer UID');
  if (!currentUser) return alert('login first');
  await supabase.from('chat_requests').insert([{ from_uid: currentUser.id, from_email: currentUser.email, to_uid: target, created_at: new Date() }]);
  alert('Request sent');
};

btnOpenScanner.onclick = () => {
  scannerEl.classList.remove('hidden');
  startScanner();
};

closeScanner.onclick = () => {
  stopScanner();
  scannerEl.classList.add('hidden');
};

function startScanner() {
  qrScanner = new QrScanner(qrVideo, result => {
    stopScanner();
    scannerEl.classList.add('hidden');
    try {
      const payload = JSON.parse(result);
      if (payload.uid) {
        peerIdInput.value = payload.uid;
        if (confirm('Send request to ' + payload.uid + '?')) sendRequestTo(payload.uid);
      } else {
        peerIdInput.value = result;
        if (confirm('Send request to ' + result + '?')) sendRequestTo(result);
      }
    } catch (err) {
      peerIdInput.value = result;
      if (confirm('Send request to ' + result + '?')) sendRequestTo(result);
    }
  });
  QrScanner.hasCamera().then(has => { if (has) qrScanner.start(); else alert('No camera found'); });
}

function stopScanner() {
  if (qrScanner) { qrScanner.stop(); qrScanner.destroy(); qrScanner = null; }
}

async function sendRequestTo(peerUid) {
  if (!currentUser) return alert('login first');
  await supabase.from('chat_requests').insert([{ from_uid: currentUser.id, from_email: currentUser.email, to_uid: peerUid, created_at: new Date() }]);
  alert('Request sent');
    }
