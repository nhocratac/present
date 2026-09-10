# Consumer Liveness & Rebalance

Slide deck HTML về Kafka consumer liveness — `heartbeat` vs `max.poll.interval.ms`,
rebalance protocol (eager / cooperative / static membership / KIP-848), và cách
tách xử lý ra khỏi poll loop bằng `pause()` / `resume()`.

**Xem slide:** https://nhocratac.github.io/present/

> GitHub không render HTML khi xem file trong repo — phải mở qua link GitHub Pages ở trên.

## Điều khiển

| Phím | Tác dụng |
|---|---|
| `←` `→` | chuyển slide |
| `T` | mở / đóng mục lục |
| `F` | toàn màn hình |
| `#4` trong URL | deep-link thẳng vào slide 4 |

## Slide có animation tương tác

Bấm nút trên slide, chạy theo từng bước — không tự động, để dừng ở đâu cũng nói tiếp được.

| Slide | Minh hoạ |
|---|---|
| 04 — Hai liveness channel | heartbeat thread vs container thread chạy thật; giả lập *xử lý treo* và *kill -9* để thấy channel nào kêu |
| 06 — Poll loop | 6 việc `poll()` làm, fetch buffer, timer reset |
| 07 — Eager rebalance | revoke toàn bộ → stop-the-world, `0 / 6` partition còn xử lý |
| 08 — Cooperative rebalance | chỉ revoke partition phải chuyển, `4 / 2` |
| 09 — Eager vs cooperative | hai group chạy song song trên cùng trục thời gian: 24.0 vs 9.0 partition-giây bị mất |
| 10 — Static membership | rolling deploy 20 pod: 40 rebalance vs 0 |
| 13 — pause / resume | worker chạy 4 phút, container vẫn giữ đúng lời hứa với channel 2 |

Ví dụ code dùng **Spring Kafka** (`@KafkaListener`, `MessageListenerContainer.pausePartition`,
`AckMode.MANUAL_IMMEDIATE` + `asyncAcks`), không phải Java consumer thuần.

## Chạy local

```
python3 -m http.server 8000
```

Rồi mở http://localhost:8000 — hoặc mở thẳng `index.html` bằng browser cũng được.

## Cấu trúc

```
index.html          18 slide
css/deck.css
js/deck.js          navigation, spine, mục lục, scaling
js/anim-liveness.js     slide 4
js/anim-pollloop.js     slide 6
js/anim-rebalance.js    slide 7 + 8
js/anim-race.js         slide 9
js/anim-static.js       slide 10
js/anim-pause.js        slide 13
```
