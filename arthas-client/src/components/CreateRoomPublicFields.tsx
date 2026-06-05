/**
 * @file CreateRoomPublicFields — toggle and form fields for listing a room in Arthas Hub.
 *
 * When enabled, shows Title, Description, and Tags inputs with client-side validation.
 *
 * @module components/CreateRoomPublicFields
 */

import { useState } from 'react';
import { useTranslation } from '../i18n';

export interface PublicFieldsData {
  isPublic: boolean;
  title: string;
  description: string;
  tags: string[];
}

interface CreateRoomPublicFieldsProps {
  value: PublicFieldsData;
  onChange: (data: PublicFieldsData) => void;
}

const TAG_REGEX = /^[a-zA-Z0-9-]+$/;
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 20;

export function CreateRoomPublicFields({ value, onChange }: CreateRoomPublicFieldsProps) {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState('');

  const update = (partial: Partial<PublicFieldsData>) => {
    onChange({ ...value, ...partial });
  };

  const handleToggle = (checked: boolean) => {
    update({ isPublic: checked });
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    setTagError('');

    if (!tag) return;
    if (value.tags.length >= MAX_TAGS) {
      setTagError(t('hub.public.tagMaxError'));
      return;
    }
    if (tag.length > MAX_TAG_LENGTH) {
      setTagError(t('hub.public.tagLengthError'));
      return;
    }
    if (!TAG_REGEX.test(tag)) {
      setTagError(t('hub.public.tagFormatError'));
      return;
    }
    if (value.tags.includes(tag)) {
      setTagInput('');
      return;
    }

    update({ tags: [...value.tags, tag] });
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    update({ tags: value.tags.filter((item) => item !== tag) });
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const titleValid = !value.isPublic || (value.title.trim().length >= 1 && value.title.trim().length <= 50);

  return (
    <div className="space-y-3">
      {/* Public toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="public-toggle"
          checked={value.isPublic}
          onChange={(e) => handleToggle(e.target.checked)}
          className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500"
        />
        <label htmlFor="public-toggle" className="text-sm text-gray-300">
          🌐 {t('hub.public.toggle')}
        </label>
      </div>

      {/* Conditional fields */}
      {value.isPublic && (
        <div className="pl-6 space-y-3 border-l-2 border-gray-700">
          {/* Title */}
          <div className="space-y-1">
            <input
              type="text"
              maxLength={50}
              value={value.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder={t('hub.public.titlePlaceholder')}
              className="w-full px-3 py-2 bg-gray-700 text-white text-sm rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
            />
            {value.title.length > 0 && !titleValid && (
              <p className="text-xs text-red-400">{t('hub.public.titleError')}</p>
            )}
          </div>

          {/* Description */}
          <textarea
            maxLength={200}
            value={value.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder={t('hub.public.descPlaceholder')}
            rows={2}
            className="w-full px-3 py-2 bg-gray-700 text-white text-sm rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors resize-none"
          />

          {/* Tags */}
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={MAX_TAG_LENGTH}
                value={tagInput}
                onChange={(e) => { setTagInput(e.target.value); setTagError(''); }}
                onKeyDown={handleTagKeyDown}
                placeholder={t('hub.public.tagPlaceholder')}
                className="flex-1 px-3 py-2 bg-gray-700 text-white text-sm rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
              />
              <button
                type="button"
                onClick={handleAddTag}
                disabled={value.tags.length >= MAX_TAGS}
                className="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 rounded-lg border border-gray-600 transition-colors"
              >
                +
              </button>
            </div>
            {tagError && <p className="text-xs text-red-400">{tagError}</p>}
            {value.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {value.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded-full"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      aria-label={`Remove tag: ${tag}`}
                      className="text-gray-500 hover:text-gray-300"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
