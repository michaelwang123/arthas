/**
 * @file TemplateGrid — responsive grid of room template cards with selection prompt.
 *
 * Renders a "Quick Create" section header, maps ROOM_TEMPLATES to TemplateCard
 * components with staggered animation delays, and manages the internal prompt state
 * for nickname entry when a template is selected.
 *
 * @module hub/templates/TemplateGrid
 * @see templateConfig.ts — ROOM_TEMPLATES data
 * @see TemplateCard.tsx — individual card component
 * @see TemplateNicknamePrompt.tsx — nickname/password prompt
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n';
import { ROOM_TEMPLATES, type TemplateConfig } from './templateConfig';
import { TemplateCard } from './TemplateCard';
import { TemplateNicknamePrompt } from './TemplateNicknamePrompt';

export interface TemplateGridProps {
  /** Callback when user completes template selection flow */
  onCreateFromTemplate: (template: TemplateConfig, nickname: string, password?: string) => void;
  /** Whether room creation is in progress (disables prompt confirm) */
  isCreating: boolean;
  /** Error message to display inline in the prompt area */
  createError: string | null;
}

/**
 * TemplateGrid renders the "Quick Create" section with all available room templates
 * in a responsive grid layout. Manages internal selection state to show the nickname
 * prompt when a template card is clicked.
 */
export function TemplateGrid({ onCreateFromTemplate, isCreating, createError }: TemplateGridProps) {
  const { t } = useTranslation();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateConfig | null>(null);

  const handleSelect = useCallback((template: TemplateConfig) => {
    setSelectedTemplate(template);
  }, []);

  const handleCancel = useCallback(() => {
    setSelectedTemplate(null);
  }, []);

  // Auto-clear selection when creation transitions from in-progress to complete (no error)
  const prevIsCreatingRef = useRef(false);
  useEffect(() => {
    if (prevIsCreatingRef.current && !isCreating && !createError) {
      setSelectedTemplate(null);
    }
    prevIsCreatingRef.current = isCreating;
  }, [isCreating, createError]);

  const handleConfirm = useCallback(
    (nickname: string, password?: string) => {
      if (!selectedTemplate) return;
      onCreateFromTemplate(selectedTemplate, nickname, password);
    },
    [selectedTemplate, onCreateFromTemplate]
  );

  return (
    <section className="space-y-4">
      {/* Section header */}
      <h2 className="text-lg font-semibold text-white">
        {t('hub.templates.sectionTitle')}
      </h2>

      {/* Responsive template card grid */}
      <div
        role="list"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
      >
        {ROOM_TEMPLATES.map((template, index) => (
          <TemplateCard
            key={template.id}
            template={template}
            index={index}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* Nickname prompt — shown when a template is selected */}
      {selectedTemplate && (
        <TemplateNicknamePrompt
          template={selectedTemplate}
          isCreating={isCreating}
          createError={createError}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </section>
  );
}
