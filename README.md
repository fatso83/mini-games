# Collection of simple games 

> A small experiment to create a little collection of free 
> games for the kids to enjoy without spending much time
> (but possibly a lot of tokens 🤖)

# Snake
First one out. First a POC (took one hour with GPT 5.6 Terra).
- Functional architecture (state machine)
- easily unit testable engine

## Next iterations

### multi-player
Not sure if going with a WebSocket server or P2P (using WebRTC). P2P suffers from hacking, but not a problem at this scale, me thinks. And I could 
theoretically do without a server (but would practically need one for connecting players). Since I would need a server anyway, I might
spin up some persistent [CloudFlare Worker](https://developers.cloudflare.com/workers/examples/websockets/) to do the coordination.

# Pac-Man clone
TBD
