package match

func init() {
	if len(matchNames)%2 != 0 {
		panic("match: matchNames must have even length (names are used in position pairs)")
	}
}

// matchNames is a fixed list of distinguishable emoji+animal pairs.
// List must have even length (names are used in position pairs).
// 32 pairs (64 entries) ensures <3.2% collision rate for consecutive matches.
var matchNames = []string{
	"🐱 Cat", "🦊 Fox", "🐼 Panda", "🦁 Lion",
	"🐨 Koala", "🦄 Unicorn", "🐙 Octopus", "🦋 Butterfly",
	"🐬 Dolphin", "🦉 Owl", "🐺 Wolf", "🦈 Shark",
	"🐯 Tiger", "🦅 Eagle", "🐸 Frog", "🦜 Parrot",
	"🐻 Bear", "🦚 Peacock", "🐧 Penguin", "🦩 Flamingo",
	"🐢 Turtle", "🦔 Hedgehog", "🐝 Bee", "🦀 Crab",
	"🐳 Whale", "🦒 Giraffe", "🐴 Horse", "🦥 Sloth",
	"🐑 Sheep", "🦦 Otter", "🐘 Elephant", "🦘 Kangaroo",
	"🐿️ Squirrel", "🦫 Beaver", "🪿 Goose", "🐓 Rooster",
	"🐕 Dog", "🦌 Deer", "🐈 Kitten", "🦎 Lizard",
	"🐇 Rabbit", "🦢 Swan", "🐊 Crocodile", "🦡 Badger",
	"🐉 Dragon", "🦏 Rhino", "🦧 Orangutan", "🐋 Humpback",
	"🦙 Llama", "🐫 Camel", "🐠 Fish", "🦑 Squid",
	"🐁 Mouse", "🦃 Turkey", "🐎 Stallion", "🦞 Lobster",
	"🦝 Raccoon", "🐄 Cow", "🐲 Serpent", "🦗 Cricket",
	"🦤 Dodo", "🐐 Goat", "🐏 Ram", "🦂 Scorpion",
}

// GenerateMatchName returns a deterministic display name for a match participant.
// position: 0 for Client A, 1 for Client B.
// roomId: used as seed to select the name pair (ensures both clients see consistent names).
//
// Algorithm:
//  1. Hash roomId → index into matchNames (even index)
//  2. Client A gets matchNames[index], Client B gets matchNames[index+1]
//
// This is deterministic: same roomId + position always yields the same name.
func GenerateMatchName(roomId string, position int) string {
	if position < 0 || position > 1 {
		return "Stranger"
	}
	if roomId == "" {
		if position == 0 {
			return "Stranger A"
		}
		return "Stranger B"
	}

	var hash uint32
	for _, c := range roomId {
		hash = hash*31 + uint32(c)
	}

	pairIndex := int(hash%uint32(len(matchNames)/2)) * 2
	return matchNames[pairIndex+position]
}
