// GENERATED FILE — do not edit by hand.
// Source: contracts/solana/target/idl/dropchad.json
// Regenerate with: npm run sync:idl

export const dropchadIdl = {
  "address": "EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft",
  "metadata": {
    "name": "dropchad",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "dropchad merkle drops on Solana."
  },
  "instructions": [
    {
      "name": "activate",
      "docs": [
        "6.2. Anyone. Balance must cover `gross_required`. Pays the fee."
      ],
      "discriminator": [
        194,
        203,
        35,
        100,
        151,
        55,
        170,
        82
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "drop",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop.creator_commitment",
                "account": "Drop"
              },
              {
                "kind": "account",
                "path": "drop.nonce",
                "account": "Drop"
              }
            ]
          }
        },
        {
          "name": "fee_wallet",
          "writable": true
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "vault",
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "drop"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "cancel_unfunded",
      "docs": [
        "6.6. Anyone, after the funding deadline, when never activated."
      ],
      "discriminator": [
        7,
        11,
        92,
        226,
        201,
        56,
        156,
        158
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "drop",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop.creator_commitment",
                "account": "Drop"
              },
              {
                "kind": "account",
                "path": "drop.nonce",
                "account": "Drop"
              }
            ]
          }
        },
        {
          "name": "refund_recipient",
          "writable": true
        },
        {
          "name": "mint",
          "docs": [
            "Compared to `drop.asset` in the handler. Read for `transfer_checked`."
          ],
          "optional": true
        },
        {
          "name": "vault",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "drop"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "refund_ata",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "refund_recipient"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "optional": true
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "docs": [
        "6.3. Anyone. Pays the recipient inside the leaf, never the caller."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "drop",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop.creator_commitment",
                "account": "Drop"
              },
              {
                "kind": "account",
                "path": "drop.nonce",
                "account": "Drop"
              }
            ]
          },
          "relations": [
            "bitmap"
          ]
        },
        {
          "name": "bitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "mint",
          "docs": [
            "Compared to `drop.asset` in the handler. Read for `transfer_checked`."
          ],
          "optional": true
        },
        {
          "name": "vault",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "drop"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipient_ata",
          "docs": [
            "program's idempotent create when missing, so it knows whether this claim made it.",
            "The ATA program refuses any other address, and an existing account of another owner or",
            "mint; `transfer_checked` refuses another mint again."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u32"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "claim_handle",
      "docs": [
        "Anyone. Pays the recipient the binder signed for, after the Ed25519 instruction",
        "directly before this one. The proof fixes who and how much, the binding fixes where."
      ],
      "discriminator": [
        93,
        142,
        47,
        111,
        164,
        134,
        99,
        181
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "drop",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop.creator_commitment",
                "account": "Drop"
              },
              {
                "kind": "account",
                "path": "drop.nonce",
                "account": "Drop"
              }
            ]
          },
          "relations": [
            "bitmap"
          ]
        },
        {
          "name": "bitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "mint",
          "docs": [
            "Compared to `drop.asset` in the handler. Read for `transfer_checked`."
          ],
          "optional": true
        },
        {
          "name": "vault",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "drop"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipient_ata",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u32"
        },
        {
          "name": "x_id",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "close_drop",
      "docs": [
        "6.10. Anyone, after finish. Rent back to the rent payer. The drop account stays."
      ],
      "discriminator": [
        179,
        36,
        175,
        45,
        105,
        230,
        234,
        147
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "drop",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop.creator_commitment",
                "account": "Drop"
              },
              {
                "kind": "account",
                "path": "drop.nonce",
                "account": "Drop"
              }
            ]
          },
          "relations": [
            "bitmap"
          ]
        },
        {
          "name": "bitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop"
              }
            ]
          }
        },
        {
          "name": "rent_payer",
          "writable": true
        },
        {
          "name": "refund_recipient",
          "writable": true
        },
        {
          "name": "mint",
          "docs": [
            "Compared to `drop.asset` in the handler. Read for `transfer_checked`."
          ],
          "optional": true
        },
        {
          "name": "vault",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "drop"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "refund_ata",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "refund_recipient"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "optional": true
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "create_drop",
      "docs": [
        "6.1. Relayer only. Creates the drop, the bitmap and, for SPL, the vault."
      ],
      "discriminator": [
        157,
        142,
        145,
        247,
        92,
        73,
        59,
        48
      ],
      "accounts": [
        {
          "name": "relayer",
          "docs": [
            "Pays every rent. Recorded as `drop.rent_payer`."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "drop",
          "docs": [
            "`init` is the `saltUsed` map."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "arg",
                "path": "params.creator_commitment"
              },
              {
                "kind": "arg",
                "path": "params.nonce"
              }
            ]
          }
        },
        {
          "name": "bitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "A mint of either token program. A non mint account fails while it loads with",
            "Anchor's `AccountOwnedByWrongProgram` (3007). The program match, the extensions and the",
            "freeze authority are checked in the handler, before the vault exists."
          ],
          "optional": true
        },
        {
          "name": "vault",
          "docs": [
            "refused mint never gets a vault. The ATA program refuses any address other than the",
            "associated token account of `(drop, mint, token_program)`."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "docs": [
            "The mint's own program, classic or Token-2022. Checked against the mint's owner in",
            "the handler, `WrongTokenProgram`."
          ],
          "optional": true
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "CreateParams"
            }
          }
        }
      ]
    },
    {
      "name": "initialize_config",
      "docs": [
        "6.0. Once per cluster, signed by the upgrade authority."
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft"
        },
        {
          "name": "program_data"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "chain_id",
          "type": "u64"
        },
        {
          "name": "relayer",
          "type": "pubkey"
        },
        {
          "name": "fee_wallet",
          "type": "pubkey"
        },
        {
          "name": "default_fee_bps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "migrate_config",
      "docs": [
        "Once, on a cluster whose `Config` predates handle mode."
      ],
      "discriminator": [
        92,
        131,
        58,
        105,
        210,
        154,
        224,
        193
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must equal the admin stored in the old bytes. Pays the extra rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "`handlers::migrate_config` before anything is written."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "refund",
      "docs": [
        "6.7. Anyone, after the claim deadline. Leftovers to the refund recipient."
      ],
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "drop",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop.creator_commitment",
                "account": "Drop"
              },
              {
                "kind": "account",
                "path": "drop.nonce",
                "account": "Drop"
              }
            ]
          }
        },
        {
          "name": "refund_recipient",
          "writable": true
        },
        {
          "name": "mint",
          "docs": [
            "Compared to `drop.asset` in the handler. Read for `transfer_checked`."
          ],
          "optional": true
        },
        {
          "name": "vault",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "drop"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "refund_ata",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "refund_recipient"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "optional": true
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "revoke_binder",
      "docs": [
        "The admin or the guardian. Stops every handle claim at once."
      ],
      "discriminator": [
        188,
        228,
        31,
        129,
        228,
        192,
        53,
        7
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "set_admin",
      "docs": [
        "6.11. Hands admin to a new key, one step."
      ],
      "discriminator": [
        251,
        163,
        0,
        52,
        91,
        194,
        187,
        92
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "admin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "set_binder",
      "docs": [
        "The ed25519 binder. Clears the revoke."
      ],
      "discriminator": [
        77,
        205,
        137,
        76,
        225,
        173,
        11,
        108
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "binder",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "set_default_fee_bps",
      "docs": [
        "6.11. Fee for new drops, capped at `MAX_FEE_BPS`."
      ],
      "discriminator": [
        20,
        198,
        50,
        140,
        149,
        121,
        207,
        223
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "bps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "set_fee_per_receiver",
      "docs": [
        "The minimum fee per receiver for new SOL drops, capped at",
        "`MAX_MIN_FEE_PER_RECEIVER_LAMPORTS`. Zero is off."
      ],
      "discriminator": [
        234,
        137,
        207,
        232,
        176,
        68,
        67,
        111
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "set_fee_wallet",
      "docs": [
        "6.11. Fee target for new drops."
      ],
      "discriminator": [
        108,
        242,
        79,
        79,
        203,
        119,
        109,
        211
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "fee_wallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "set_guardian",
      "docs": [
        "May revoke and nothing else. Zero means none."
      ],
      "discriminator": [
        147,
        243,
        50,
        121,
        154,
        164,
        50,
        30
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "guardian",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "set_max_fee",
      "docs": [
        "The cap on the fee of new SOL drops, at most `MAX_SOL_FEE_LAMPORTS`. Zero is no cap."
      ],
      "discriminator": [
        35,
        55,
        192,
        242,
        72,
        189,
        57,
        178
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "set_min_fee",
      "docs": [
        "The flat minimum fee for new SOL drops, capped at `MAX_MIN_FEE_LAMPORTS`."
      ],
      "discriminator": [
        114,
        198,
        35,
        3,
        41,
        196,
        194,
        246
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "set_paused",
      "docs": [
        "6.11. Blocks new drops only."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "set_relayer",
      "docs": [
        "6.11. The one key allowed to sign `create_drop`. Rotates the relayer."
      ],
      "discriminator": [
        23,
        243,
        33,
        88,
        110,
        84,
        196,
        37
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "relayer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "sweep",
      "docs": [
        "6.8. Anyone, after finish. A wrong mint goes to the refund recipient."
      ],
      "discriminator": [
        40,
        23,
        234,
        175,
        14,
        61,
        154,
        177
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "drop",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "drop.creator_commitment",
                "account": "Drop"
              },
              {
                "kind": "account",
                "path": "drop.nonce",
                "account": "Drop"
              }
            ]
          }
        },
        {
          "name": "refund_recipient",
          "writable": true
        },
        {
          "name": "mint",
          "docs": [
            "Any mint of either program. A Token-2022 mint must pass the extension",
            "check in the handler. The handler refuses `drop.asset`."
          ]
        },
        {
          "name": "stray_ata",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "drop"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "refund_ata",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "refund_recipient"
              },
              {
                "kind": "account",
                "path": "token_program"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "docs": [
            "The stray mint's own program."
          ]
        },
        {
          "name": "associated_token_program",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "ClaimBitmap",
      "discriminator": [
        61,
        25,
        148,
        196,
        164,
        208,
        65,
        169
      ]
    },
    {
      "name": "Config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "Drop",
      "discriminator": [
        56,
        174,
        80,
        200,
        182,
        146,
        223,
        35
      ]
    }
  ],
  "events": [
    {
      "name": "Activated",
      "discriminator": [
        140,
        38,
        35,
        97,
        110,
        193,
        239,
        71
      ]
    },
    {
      "name": "AdminSet",
      "discriminator": [
        157,
        245,
        205,
        226,
        118,
        125,
        183,
        97
      ]
    },
    {
      "name": "BinderRevoked",
      "discriminator": [
        223,
        250,
        169,
        225,
        251,
        143,
        222,
        101
      ]
    },
    {
      "name": "BinderSet",
      "discriminator": [
        137,
        253,
        85,
        67,
        144,
        248,
        174,
        240
      ]
    },
    {
      "name": "CancelledUnfunded",
      "discriminator": [
        107,
        82,
        228,
        49,
        207,
        122,
        120,
        213
      ]
    },
    {
      "name": "Claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "Closed",
      "discriminator": [
        50,
        31,
        87,
        155,
        135,
        220,
        195,
        239
      ]
    },
    {
      "name": "ConfigInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "ConfigMigrated",
      "discriminator": [
        115,
        69,
        99,
        100,
        192,
        77,
        40,
        50
      ]
    },
    {
      "name": "DefaultFeeBpsSet",
      "discriminator": [
        219,
        161,
        93,
        229,
        57,
        253,
        209,
        121
      ]
    },
    {
      "name": "DropCreated",
      "discriminator": [
        179,
        166,
        43,
        166,
        63,
        69,
        138,
        46
      ]
    },
    {
      "name": "FeePerReceiverSet",
      "discriminator": [
        71,
        4,
        84,
        247,
        198,
        226,
        189,
        187
      ]
    },
    {
      "name": "FeeWalletSet",
      "discriminator": [
        66,
        86,
        57,
        187,
        128,
        107,
        162,
        77
      ]
    },
    {
      "name": "Finalized",
      "discriminator": [
        4,
        77,
        242,
        80,
        20,
        152,
        247,
        252
      ]
    },
    {
      "name": "GuardianSet",
      "discriminator": [
        159,
        49,
        155,
        156,
        176,
        88,
        29,
        190
      ]
    },
    {
      "name": "HandleClaimed",
      "discriminator": [
        23,
        183,
        225,
        13,
        62,
        87,
        199,
        150
      ]
    },
    {
      "name": "MaxFeeSet",
      "discriminator": [
        51,
        227,
        69,
        184,
        238,
        58,
        49,
        194
      ]
    },
    {
      "name": "MinFeeSet",
      "discriminator": [
        60,
        127,
        101,
        230,
        216,
        129,
        188,
        98
      ]
    },
    {
      "name": "PausedSet",
      "discriminator": [
        171,
        125,
        127,
        156,
        233,
        81,
        68,
        66
      ]
    },
    {
      "name": "Refunded",
      "discriminator": [
        35,
        103,
        149,
        246,
        196,
        123,
        221,
        99
      ]
    },
    {
      "name": "RelayerSet",
      "discriminator": [
        215,
        1,
        21,
        160,
        138,
        169,
        70,
        40
      ]
    },
    {
      "name": "Swept",
      "discriminator": [
        254,
        138,
        9,
        198,
        192,
        61,
        165,
        135
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "NotImplemented",
      "msg": "instruction not implemented yet"
    },
    {
      "code": 6001,
      "name": "NotUpgradeAuthority",
      "msg": "signer is not the program upgrade authority"
    },
    {
      "code": 6002,
      "name": "FeeTooHigh",
      "msg": "fee bps above MAX_FEE_BPS"
    },
    {
      "code": 6003,
      "name": "ZeroAddress",
      "msg": "zero address"
    },
    {
      "code": 6004,
      "name": "NotAdmin",
      "msg": "signer is not the admin"
    },
    {
      "code": 6005,
      "name": "NotRelayer",
      "msg": "signer is not the relayer"
    },
    {
      "code": 6006,
      "name": "CreationPaused",
      "msg": "drop creation is paused"
    },
    {
      "code": 6007,
      "name": "ZeroTotal",
      "msg": "total entitlements is zero"
    },
    {
      "code": 6008,
      "name": "BadLeafCount",
      "msg": "leaf count is zero or above MAX_LEAVES"
    },
    {
      "code": 6009,
      "name": "ZeroRoot",
      "msg": "merkle root is zero"
    },
    {
      "code": 6010,
      "name": "ZeroManifest",
      "msg": "manifest hash is zero"
    },
    {
      "code": 6011,
      "name": "ZeroRefundRecipient",
      "msg": "refund recipient is the zero key"
    },
    {
      "code": 6012,
      "name": "ZeroCommitment",
      "msg": "creator commitment is zero"
    },
    {
      "code": 6013,
      "name": "BadFundingPeriod",
      "msg": "funding period out of bounds"
    },
    {
      "code": 6014,
      "name": "BadClaimPeriod",
      "msg": "claim period out of bounds"
    },
    {
      "code": 6015,
      "name": "WrongTokenProgram",
      "msg": "token program is not the mint's owner"
    },
    {
      "code": 6016,
      "name": "MintHasFreezeAuthority",
      "msg": "mint has a freeze authority"
    },
    {
      "code": 6017,
      "name": "Overflow",
      "msg": "arithmetic overflow"
    },
    {
      "code": 6018,
      "name": "WrongStatus",
      "msg": "wrong status for this instruction"
    },
    {
      "code": 6019,
      "name": "FundingExpired",
      "msg": "funding deadline has passed"
    },
    {
      "code": 6020,
      "name": "Underfunded",
      "msg": "balance below gross required"
    },
    {
      "code": 6021,
      "name": "WrongFeeWallet",
      "msg": "fee wallet does not match the drop"
    },
    {
      "code": 6022,
      "name": "AssetAccountsMismatch",
      "msg": "asset accounts do not match the drop asset"
    },
    {
      "code": 6023,
      "name": "ClaimWindowClosed",
      "msg": "claim window is closed"
    },
    {
      "code": 6024,
      "name": "BadIndex",
      "msg": "index is at or above leaf count"
    },
    {
      "code": 6025,
      "name": "AlreadyClaimed",
      "msg": "leaf already claimed"
    },
    {
      "code": 6026,
      "name": "BadProof",
      "msg": "merkle proof does not verify"
    },
    {
      "code": 6027,
      "name": "OverEntitlement",
      "msg": "claim would exceed total entitlements"
    },
    {
      "code": 6028,
      "name": "FundingStillOpen",
      "msg": "funding window is still open"
    },
    {
      "code": 6029,
      "name": "ClaimWindowOpen",
      "msg": "claim window is still open"
    },
    {
      "code": 6030,
      "name": "WrongRefundRecipient",
      "msg": "refund recipient does not match the drop"
    },
    {
      "code": 6031,
      "name": "CannotSweepDropAsset",
      "msg": "sweep can never touch the drop asset"
    },
    {
      "code": 6032,
      "name": "NotFinished",
      "msg": "drop is not finished"
    },
    {
      "code": 6033,
      "name": "NothingToSweep",
      "msg": "nothing to sweep"
    },
    {
      "code": 6034,
      "name": "AlreadyClosed",
      "msg": "drop is already closed"
    },
    {
      "code": 6035,
      "name": "WrongRentPayer",
      "msg": "rent payer does not match the drop"
    },
    {
      "code": 6036,
      "name": "AlreadyMigrated",
      "msg": "config is not the 116 byte legacy layout"
    },
    {
      "code": 6037,
      "name": "NotAdminOrGuardian",
      "msg": "signer is neither the admin nor the guardian"
    },
    {
      "code": 6038,
      "name": "BadXId",
      "msg": "x id is zero"
    },
    {
      "code": 6039,
      "name": "NoBinder",
      "msg": "no binder is set"
    },
    {
      "code": 6040,
      "name": "BinderIsRevoked",
      "msg": "the binder is revoked"
    },
    {
      "code": 6041,
      "name": "BadBinding",
      "msg": "the binding is missing, malformed or not the binder's"
    },
    {
      "code": 6042,
      "name": "MintExtensionNotAllowed",
      "msg": "the mint has a Token-2022 extension that is not allowed"
    },
    {
      "code": 6043,
      "name": "SolFeeTooHigh",
      "msg": "sol fee above the cap, or not zero on a SOL drop"
    }
  ],
  "types": [
    {
      "name": "Activated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "activated_at",
            "type": "i64"
          },
          {
            "name": "balance",
            "type": "u64"
          },
          {
            "name": "claim_deadline",
            "type": "i64"
          },
          {
            "name": "fee_paid",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "AdminSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_admin",
            "type": "pubkey"
          },
          {
            "name": "new_admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "BinderRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "by",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "BinderSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_binder",
            "type": "pubkey"
          },
          {
            "name": "new_binder",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "CancelledUnfunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "refund_recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ClaimBitmap",
      "docs": [
        "5.5. One per drop, at `[\"bitmap\", drop]`. Fixed size for `MAX_LEAVES`.",
        "",
        "Zero copy: 1,250 bytes must never be copied onto the 4 KB program stack. Read through",
        "`AccountLoader`, `load()` / `load_mut()`. `repr(C)`, no padding: 32 + 1 + 1,250 = 1,283 bytes."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "bits",
            "type": {
              "array": [
                "u8",
                1250
              ]
            }
          }
        ]
      }
    },
    {
      "name": "Claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Closed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "rent_payer",
            "type": "pubkey"
          },
          {
            "name": "leftovers_to_refund_recipient",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Config",
      "docs": [
        "5.1. One per cluster, at `[\"config\"]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "relayer",
            "docs": [
              "The only key that may sign `create_drop`. One key, not a map."
            ],
            "type": "pubkey"
          },
          {
            "name": "fee_wallet",
            "type": "pubkey"
          },
          {
            "name": "default_fee_bps",
            "type": "u16"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "chain_id",
            "docs": [
              "Immutable. The leaf chain id for this cluster."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "binder",
            "docs": [
              "The ed25519 binder of. Zero means none: every `claim_handle` fails."
            ],
            "type": "pubkey"
          },
          {
            "name": "binder_revoked",
            "docs": [
              "Set by `revoke_binder`, cleared by `set_binder`."
            ],
            "type": "bool"
          },
          {
            "name": "guardian",
            "docs": [
              "May sign `revoke_binder` and nothing else. Zero means none; the admin can always revoke."
            ],
            "type": "pubkey"
          },
          {
            "name": "min_fee_lamports",
            "docs": [
              "The flat minimum fee for new SOL drops."
            ],
            "type": "u64"
          },
          {
            "name": "min_fee_per_receiver_lamports",
            "docs": [
              "The minimum fee per receiver for new SOL drops, times `leaf_count`. Zero is off."
            ],
            "type": "u64"
          },
          {
            "name": "max_fee_lamports",
            "docs": [
              "The cap on the fee of new SOL drops. Zero is no cap."
            ],
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Zero. Room for the next fields without another layout change."
            ],
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ConfigInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "relayer",
            "type": "pubkey"
          },
          {
            "name": "fee_wallet",
            "type": "pubkey"
          },
          {
            "name": "default_fee_bps",
            "type": "u16"
          },
          {
            "name": "chain_id",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ConfigMigrated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_len",
            "type": "u32"
          },
          {
            "name": "new_len",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "CreateParams",
      "docs": [
        "6.1. The asset is not here: it is the `mint` account when one is passed, SOL when none is."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merkle_root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manifest_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "total_entitlements",
            "type": "u64"
          },
          {
            "name": "leaf_count",
            "type": "u32"
          },
          {
            "name": "refund_recipient",
            "type": "pubkey"
          },
          {
            "name": "creator_commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "funding_period",
            "type": "u32"
          },
          {
            "name": "claim_period",
            "type": "u32"
          },
          {
            "name": "sol_fee_lamports",
            "docs": [
              "Token drop: the SOL fee, at most `MAX_SOL_FEE_LAMPORTS`. SOL drop: zero."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "DefaultFeeBpsSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_bps",
            "type": "u16"
          },
          {
            "name": "new_bps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "Drop",
      "docs": [
        "5.2 to 5.4. One per drop, at `[\"drop\", creator_commitment, nonce_le]`. Never closed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "docs": [
              "`Pubkey::default()` means native SOL. Otherwise the one mint."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "The associated token account of `(drop, mint)` for SPL. `Pubkey::default()` for SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "merkle_root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manifest_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "total_entitlements",
            "type": "u64"
          },
          {
            "name": "gross_required",
            "type": "u64"
          },
          {
            "name": "fee_amount",
            "type": "u64"
          },
          {
            "name": "fee_wallet",
            "type": "pubkey"
          },
          {
            "name": "refund_recipient",
            "type": "pubkey"
          },
          {
            "name": "funding_deadline",
            "type": "i64"
          },
          {
            "name": "claim_period",
            "type": "u32"
          },
          {
            "name": "creator_commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "leaf_count",
            "type": "u32"
          },
          {
            "name": "chain_id",
            "docs": [
              "Copied from `config.chain_id` so `claim` never needs the config account."
            ],
            "type": "u64"
          },
          {
            "name": "rent_payer",
            "docs": [
              "`close_drop` returns rent here and nowhere else."
            ],
            "type": "pubkey"
          },
          {
            "name": "created_at",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "bitmap_bump",
            "type": "u8"
          },
          {
            "name": "activated_at",
            "type": "i64"
          },
          {
            "name": "claim_deadline",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "DropStatus"
              }
            }
          },
          {
            "name": "total_claimed",
            "type": "u64"
          },
          {
            "name": "claimed_count",
            "type": "u32"
          },
          {
            "name": "closed",
            "type": "bool"
          },
          {
            "name": "sol_fee_lamports",
            "docs": [
              "The fee in SOL, at most `MAX_SOL_FEE_LAMPORTS`. Zero on a SOL drop."
            ],
            "type": "u64"
          },
          {
            "name": "account_budget_lamports",
            "docs": [
              "`leaf_count` × the rent of one receiver token account. Zero on a SOL drop."
            ],
            "type": "u64"
          },
          {
            "name": "account_budget_used",
            "docs": [
              "Paid back to claim callers so far. The one 5.2 field that changes after creation."
            ],
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Zero. Room for the next fields without losing the drops again, the lesson of."
            ],
            "type": {
              "array": [
                "u8",
                40
              ]
            }
          }
        ]
      }
    },
    {
      "name": "DropCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "creator_commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "merkle_root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manifest_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "total_entitlements",
            "type": "u64"
          },
          {
            "name": "fee_amount",
            "type": "u64"
          },
          {
            "name": "gross_required",
            "type": "u64"
          },
          {
            "name": "fee_wallet",
            "type": "pubkey"
          },
          {
            "name": "refund_recipient",
            "type": "pubkey"
          },
          {
            "name": "funding_deadline",
            "type": "i64"
          },
          {
            "name": "claim_period",
            "type": "u32"
          },
          {
            "name": "leaf_count",
            "type": "u32"
          },
          {
            "name": "chain_id",
            "type": "u64"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "rent_payer",
            "type": "pubkey"
          },
          {
            "name": "created_at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "DropStatus",
      "docs": [
        "Section 4. Borsh writes an enum as one `u8` tag, so `Created` is `0`, the value of fresh bytes."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Created"
          },
          {
            "name": "Active"
          },
          {
            "name": "Finalized"
          },
          {
            "name": "Cancelled"
          }
        ]
      }
    },
    {
      "name": "FeePerReceiverSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_lamports",
            "type": "u64"
          },
          {
            "name": "new_lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "FeeWalletSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_wallet",
            "type": "pubkey"
          },
          {
            "name": "new_wallet",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "Finalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "total_claimed",
            "type": "u64"
          },
          {
            "name": "claimed_count",
            "type": "u32"
          },
          {
            "name": "refunded",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "GuardianSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_guardian",
            "type": "pubkey"
          },
          {
            "name": "new_guardian",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "HandleClaimed",
      "docs": [
        "and 11.1. Emitted by `claim_handle` instead of `Claimed`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "x_id",
            "type": "u64"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "MaxFeeSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_lamports",
            "type": "u64"
          },
          {
            "name": "new_lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "MinFeeSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_lamports",
            "type": "u64"
          },
          {
            "name": "new_lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "PausedSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "Refunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "refund_recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "RelayerSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old_relayer",
            "type": "pubkey"
          },
          {
            "name": "new_relayer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "Swept",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drop",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    }
  ]
} as const;
