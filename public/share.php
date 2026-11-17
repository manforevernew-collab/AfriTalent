<?php
// Serves the React app for /u/:username, adding Open Graph tags (name, ★ rating, headline, photo)
// so shared profile links show a rich preview on WhatsApp, LinkedIn, X and Facebook.
// share-config.json (written at deploy) holds the Supabase URL + public (publishable) key.

$html = @file_get_contents(__DIR__ . '/index.html');
if ($html === false) { http_response_code(500); exit('Site unavailable'); }

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=300');
header('X-Content-Type-Options: nosniff');

$handle = strtolower(preg_replace('/[^A-Za-z0-9_-]/', '', $_GET['u'] ?? ''));
$cfg = json_decode(@file_get_contents(__DIR__ . '/share-config.json') ?: 'null', true);
if (!$handle || !$cfg || empty($cfg['url']) || empty($cfg['key']) || !function_exists('curl_init')) { echo $html; exit; }

$ch = curl_init(rtrim($cfg['url'], '/') . '/rest/v1/rpc/get_public_profile');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => json_encode(['p_handle' => $handle]),
  CURLOPT_HTTPHEADER => ['apikey: ' . $cfg['key'], 'Content-Type: application/json', 'Accept: application/json'],
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 4,
  CURLOPT_CONNECTTIMEOUT => 2,
]);
$res = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$p = ($res !== false && $code === 200) ? json_decode($res, true) : null;
if (!is_array($p) || empty($p['full_name'])) { echo $html; exit; }

$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
$site = 'https://' . ($_SERVER['HTTP_HOST'] ?? 'afritalent.anaefunasoftwares.com');
$rating = isset($p['rating']) && $p['rating'] !== null ? number_format((float)$p['rating'], 1) : null;
$count = (int)($p['ratings_count'] ?? 0);
$stars = $rating ? ' · ★ ' . $rating . ' (' . $count . ' review' . ($count === 1 ? '' : 's') . ')' : '';
$title = $p['full_name'] . $stars . ' | AfriTalent';
$bits = array_filter([
  $p['headline'] ?? null,
  trim(implode(' · ', array_filter([$p['profession'] ?? null, $p['location'] ?? null]))),
  !empty($p['kyc_verified']) ? '✔ ID verified' : null,
  $rating ? "Rated $rating/5 by $count customer" . ($count === 1 ? '' : 's') : 'View portfolio, services and reviews on AfriTalent',
]);
$desc = mb_substr(implode(' — ', $bits), 0, 280);
$img = (!empty($p['avatar_url']) && str_starts_with($p['avatar_url'], 'https://')) ? $p['avatar_url'] : $site . '/email-logo.png';
$url = $site . '/u/' . rawurlencode($p['username'] ?? $handle);

$meta = '<title>' . $e($title) . '</title>'
  . '<meta name="description" content="' . $e($desc) . '">'
  . '<link rel="canonical" href="' . $e($url) . '">'
  . '<meta property="og:type" content="profile">'
  . '<meta property="og:site_name" content="AfriTalent">'
  . '<meta property="og:title" content="' . $e($title) . '">'
  . '<meta property="og:description" content="' . $e($desc) . '">'
  . '<meta property="og:image" content="' . $e($img) . '">'
  . '<meta property="og:url" content="' . $e($url) . '">'
  . '<meta name="twitter:card" content="summary">'
  . '<meta name="twitter:title" content="' . $e($title) . '">'
  . '<meta name="twitter:description" content="' . $e($desc) . '">'
  . '<meta name="twitter:image" content="' . $e($img) . '">';

$out = preg_replace('#<title>.*?</title>#s', $meta, $html, 1);
echo $out ?: $html;
